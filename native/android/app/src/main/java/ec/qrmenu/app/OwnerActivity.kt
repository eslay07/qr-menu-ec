package ec.qrmenu.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.Gravity
import android.webkit.JavascriptInterface
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Button
import android.widget.ProgressBar
import android.widget.Toast
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

class OwnerActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var localButton: Button
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val fileRequest = 701
    private val platformHost = "qr-menu-ecuador-jm.eslay.chatgpt.site" // active owner subdomain

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val progress = ProgressBar(this).apply { visibility = View.GONE }
        localButton = Button(this).apply {
            text = "SERVIDOR LOCAL Y RED"
            visibility = View.GONE
            setOnClickListener { startActivity(Intent(this@OwnerActivity, MainActivity::class.java)) }
        }
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            addJavascriptInterface(object {
                @JavascriptInterface
                fun setAccessState(enabled: Boolean) {
                    runOnUiThread {
                        localButton.visibility = if (enabled) View.VISIBLE else View.GONE
                        if (!enabled) {
                            stopService(Intent(this@OwnerActivity, MenuService::class.java))
                            File(filesDir, "synced-menu.json").delete()
                        }
                    }
                }
                @JavascriptInterface
                fun syncMenu(payload: String) {
                    Thread {
                        runCatching {
                            val snapshot = JSONObject(payload)
                            val catalog = snapshot.getJSONObject("catalog")
                            val mediaDir = File(filesDir, "synced-media").apply { mkdirs() }
                            fun localize(path: String): String {
                                if (!Regex("^/r/[a-f0-9-]{36}/api/v1/media/[a-f0-9-]{36}$").matches(path)) return path
                                val id = path.substringAfterLast('/')
                                val target = File(mediaDir, id)
                                val connection = URL("https://$platformHost$path").openConnection() as HttpURLConnection
                                connection.setRequestProperty("Cookie", CookieManager.getInstance().getCookie("https://$platformHost") ?: "")
                                connection.connectTimeout = 15000
                                connection.readTimeout = 20000
                                require(connection.responseCode == 200) { "No se pudo sincronizar una foto." }
                                connection.inputStream.use { input -> target.outputStream().use { input.copyTo(it) } }
                                File(mediaDir, "$id.type").writeText(connection.contentType ?: "image/jpeg")
                                return "/local-media/$id"
                            }
                            catalog.put("logo", localize(catalog.optString("logo")))
                            val dishes = catalog.getJSONArray("dishes")
                            for (index in 0 until dishes.length()) {
                                val dish = dishes.getJSONObject(index)
                                dish.put("image", localize(dish.optString("image")))
                            }
                            File(filesDir, "synced-menu.json").writeText(snapshot.toString())
                        }.onFailure {
                            runOnUiThread { Toast.makeText(this@OwnerActivity, "El menú se guardó en Cloudflare, pero la copia local no terminó.", Toast.LENGTH_LONG).show() }
                        }
                    }.start()
                }
            }, "QrMenuAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "https" && uri.host == platformHost) return false
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { progress.visibility = View.VISIBLE }
                override fun onPageFinished(view: WebView, url: String) { progress.visibility = View.GONE }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return try {
                        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "image/*"
                        }, fileRequest)
                        true
                    } catch (_: Exception) {
                        fileCallback = null
                        Toast.makeText(this@OwnerActivity, "No se pudo abrir el selector de fotos.", Toast.LENGTH_LONG).show()
                        false
                    }
                }
            }
            loadUrl("https://$platformHost/")
        }
        setContentView(FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(-1, -1))
            addView(progress, FrameLayout.LayoutParams(-2, -2, android.view.Gravity.CENTER))
            addView(localButton, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply {
                setMargins(24, 12, 24, 24)
            })
        })
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileRequest) {
            fileCallback?.onReceiveValue(if (resultCode == RESULT_OK) data?.data?.let { arrayOf(it) } else null)
            fileCallback = null
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() { if (webView.canGoBack()) webView.goBack() else super.onBackPressed() }

    override fun onDestroy() { webView.destroy(); super.onDestroy() }
}
