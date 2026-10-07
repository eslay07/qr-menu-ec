package ec.qrmenu.app

import android.app.Activity
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintJob
import android.print.PrintManager
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/** Connects the existing print button to Android without receiving HTML or credentials. */
class OwnerPrintBridge(private val activity: Activity, private val webView: WebView, private val host: String) {
    private var attached = false
    private var job: PrintJob? = null

    fun attach() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, "qrmenuNativePrint", setOf("https://$host")) { _, message, origin, mainFrame, _ ->
            if (!mainFrame || origin.scheme != "https" || origin.host != host || message.data != "print") return@addWebMessageListener
            activity.runOnUiThread {
                val current = Uri.parse(webView.url ?: "")
                if (activity.isFinishing || activity.isDestroyed || current.scheme != "https" || current.host != host) return@runOnUiThread
                if (job?.let { !it.isCompleted && !it.isCancelled && !it.isFailed } == true) return@runOnUiThread
                try {
                    val manager = activity.getSystemService(Activity.PRINT_SERVICE) as? PrintManager
                    if (manager == null) {
                        Toast.makeText(activity, "La impresión no está disponible en este celular.", Toast.LENGTH_LONG).show()
                        return@runOnUiThread
                    }
                    val title = "QR Menu EC"
                    job = manager.print(title, webView.createPrintDocumentAdapter(title), PrintAttributes.Builder().build())
                } catch (_: Exception) {
                    Toast.makeText(activity, "No se pudo abrir la impresión. Intenta nuevamente.", Toast.LENGTH_LONG).show()
                }
            }
        }
        attached = true
    }

    fun onPageFinished(url: String) {
        val origin = Uri.parse(url)
        if (origin.scheme != "https" || origin.host != host) return
        // No JavascriptInterface fallback: expose this action only to the permitted origin.
        val script = if (attached) {
            "window.print = function () { window.qrmenuNativePrint.postMessage('print'); };"
        } else {
            "window.print = function () { window.alert('Actualiza Android System WebView para imprimir desde esta app.'); };"
        }
        webView.evaluateJavascript(script, null)
    }
}
