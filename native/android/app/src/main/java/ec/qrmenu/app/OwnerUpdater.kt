package ec.qrmenu.app

import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Internet update is optional; Android remains responsible for install consent. */
class OwnerUpdater(private val activity: OwnerActivity, private val host: String, private val unlocked: () -> Boolean) {
    private val worker = Executors.newSingleThreadExecutor()
    private var checked = false
    @Volatile private var stopped = false
    private var pending: File? = null
    private var dialog: AlertDialog? = null
    private data class Release(val code: Int, val name: String, val url: String, val hash: String, val size: Long, val certificate: String)
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun certificates(info: android.content.pm.PackageInfo): Set<String> {
        val signing = info.signingInfo ?: error("Missing signer")
        return signing.apkContentsSigners.map { digest(it.toByteArray()) }.toSet()
    }
    private fun connection(url: String): javax.net.ssl.HttpsURLConnection {
        val uri = Uri.parse(url)
        require(uri.scheme == "https" && uri.host == host && uri.port == -1 && uri.userInfo == null && uri.fragment == null)
        return (URL(url).openConnection() as javax.net.ssl.HttpsURLConnection).apply {
            useCaches = false
            setRequestProperty("Cache-Control", "no-cache")
            instanceFollowRedirects = false; connectTimeout = 10000; readTimeout = 15000
            try { require(responseCode == 200) } catch (error: Exception) { disconnect(); throw error }
        }
    }
    fun check() {
        if (checked || stopped || !unlocked()) return
        checked = true
        worker.execute {
            try {
                val c = connection("https://$host/downloads/android-release.json")
                val json = try { c.inputStream.use { input -> val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(1024); while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 16384); output.write(buffer, 0, n) }; JSONObject(output.toString("UTF-8")) } } finally { c.disconnect() }
                val release = Release(json.getInt("versionCode"), json.getString("versionName"), json.getString("url"), json.getString("sha256").lowercase(), json.getLong("size"), json.getString("certificateSha256").lowercase())
                require(release.size in 1..30L*1024*1024 && release.hash.matches(Regex("[a-f0-9]{64}")))
                val installed = activity.packageManager.getPackageInfo(activity.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                UpdatePolicy.validate(release.url, host, release.size, release.hash, release.certificate, certificates(installed))
                val uri = Uri.parse(release.url)
                require(uri.scheme == "https" && uri.host == host && uri.port == -1 && uri.userInfo == null && uri.fragment == null)
                if (release.code <= BuildConfig.VERSION_CODE) return@execute
                activity.runOnUiThread {
                    if (!stopped && unlocked()) dialog = AlertDialog.Builder(activity).setTitle("Actualización disponible")
                        .setMessage("QR Menu EC ${release.name}. Puedes continuar usando la app y actualizar cuando quieras.")
                        .setPositiveButton("Actualizar") { _, _ -> download(release) }.setNegativeButton("Ahora no", null).show()
                }
            } catch (_: Exception) { /* Offline or invalid metadata never blocks access. */ }
        }
    }
    private fun download(release: Release) {
        if (unlocked()) Toast.makeText(activity, "Descargando actualización; puedes seguir usando la app", Toast.LENGTH_LONG).show()
        worker.execute {
            val directory = File(activity.cacheDir, "updates").apply { mkdirs() }
            val file = File(directory, "owner-update.apk")
            var activeConnection: javax.net.ssl.HttpsURLConnection? = null
            try {
                val c = connection(release.url).also { activeConnection = it }
                if (c.contentLengthLong >= 0) require(c.contentLengthLong == release.size)
                val hash = MessageDigest.getInstance("SHA-256")
                var total = 0L
                c.inputStream.use { input -> file.outputStream().use { output ->
                    val buffer = ByteArray(16384)
                    while (true) { val n = input.read(buffer); if (n < 0) break; total += n; require(total <= release.size && !stopped); hash.update(buffer, 0, n); output.write(buffer, 0, n) }
                } }
                c.disconnect()
                val receivedHash = hash.digest().joinToString("") { "%02x".format(it) }
                require(total == release.size && receivedHash == release.hash)
                val info = activity.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES) ?: error("Invalid APK")
                require(info.packageName == activity.packageName && info.longVersionCode == release.code.toLong() && info.versionName == release.name)
                val own = activity.packageManager.getPackageInfo(activity.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                UpdatePolicy.validateArchive(info.packageName, activity.packageName, info.longVersionCode, release.code, BuildConfig.VERSION_CODE, certificates(info), certificates(own), release.certificate, total, release.size, receivedHash, release.hash)
                activity.runOnUiThread { if (!stopped) { pending = file; installPending() } }
            } catch (_: Exception) {
                file.delete()
                activity.runOnUiThread { if (!stopped && unlocked()) Toast.makeText(activity, "No se pudo verificar la actualización. Inténtalo en la próxima apertura.", Toast.LENGTH_LONG).show() }
            } finally { activeConnection?.disconnect() }
        }
    }
    fun installPending() {
        val file = pending ?: return
        if (stopped || !unlocked()) return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            dialog = AlertDialog.Builder(activity).setTitle("Permitir actualización")
                .setMessage("Android requiere permitir instalaciones desde QR Menu EC. Luego vuelve a la app para confirmar la instalación.")
                .setPositiveButton("Abrir ajustes") { _, _ -> activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))) }
                .setNegativeButton("Ahora no") { _, _ -> pending = null }.show()
            return
        }
        pending = null
        try {
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
            activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (_: Exception) { Toast.makeText(activity, "No se pudo abrir el instalador de Android.", Toast.LENGTH_LONG).show() }
    }
    fun hide() { dialog?.dismiss(); dialog = null }
    fun destroy() { stopped = true; hide(); worker.shutdownNow() }
}
