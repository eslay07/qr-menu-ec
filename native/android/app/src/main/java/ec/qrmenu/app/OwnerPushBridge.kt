package ec.qrmenu.app

import android.app.Activity
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.JavaScriptReplyProxy
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class OwnerPushBridge(private val activity: Activity, private val webView: WebView, private val host: String) {
    private var pending: JavaScriptReplyProxy? = null
    private val preferences = activity.getSharedPreferences("owner_push", Activity.MODE_PRIVATE)
    fun attach() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, "qrmenuPush", setOf("https://$host")) { _, message, origin, mainFrame, reply ->
            if (!mainFrame || origin.scheme != "https" || origin.host != host) return@addWebMessageListener
            val input = try { JSONObject(message.data ?: "") } catch (_: Exception) { return@addWebMessageListener }
            when (input.optString("action")) {
                "status" -> respond(reply, JSONObject().put("enabled", preferences.getBoolean("enabled", false)).toString())
                "token" -> {
                    if (pending != null) { fail(reply, "Ya hay una solicitud en curso."); return@addWebMessageListener }
                    if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        pending = reply
                        activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 703)
                    } else token(reply)
                }
                "commit" -> {
                    val restaurant = input.optString("restaurantId")
                    if (!restaurant.matches(Regex("[a-f0-9-]{36}"))) { fail(reply, "Restaurante inválido."); return@addWebMessageListener }
                    preferences.edit().putBoolean("enabled", true).putString("restaurantId", restaurant).apply()
                    respond(reply, "{\"ok\":true}")
                }
                "disable" -> {
                    preferences.edit().clear().apply()
                    activity.getSystemService(NotificationManager::class.java).cancelAll()
                    FirebaseMessaging.getInstance().isAutoInitEnabled = false
                    FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { respond(reply, "{\"ok\":true}") }
                }
            }
        }
    }
    private fun token(reply: JavaScriptReplyProxy) {
        if (!activity.getSystemService(NotificationManager::class.java).areNotificationsEnabled()) { fail(reply, "Permite notificaciones en los ajustes de Android."); return }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) respond(reply, JSONObject().put("token", task.result).toString())
            else fail(reply, "No se pudo registrar el dispositivo. Revisa Google Play Services y la conexión.")
        }
    }
    fun permissionResult() {
        val reply = pending ?: return
        pending = null
        if (Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) token(reply)
        else fail(reply, "No se concedió permiso para notificaciones.")
    }
    private fun respond(reply: JavaScriptReplyProxy, value: String) {
        if (activity.isFinishing || activity.isDestroyed) return
        try { reply.postMessage(value) } catch (_: IllegalStateException) { /* WebView navigation or destruction. */ }
    }
    private fun fail(reply: JavaScriptReplyProxy, text: String) { respond(reply, JSONObject().put("error", text).toString()) }
}
