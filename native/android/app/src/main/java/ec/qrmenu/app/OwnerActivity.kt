package ec.qrmenu.app

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.CancellationSignal
import android.graphics.Color
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class OwnerActivity : Activity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val fileRequest = 701
    private val unlockRequest = 702
    private val platformHost = "qr-menu-ec.consola.workers.dev"
    private val ownerUrl get() = "https://$platformHost/owner"
    private lateinit var lockScreen: LinearLayout
    private var lastBackground = 0L
    private var awaitingUnlock = false
    private var firstLoad = true
    private var prompting = false
    private val preferences by lazy { getSharedPreferences("owner_access", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val progress = ProgressBar(this).apply { visibility = View.GONE }
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            val hasScreenLock = (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure
            settings.userAgentString = settings.userAgentString + " QRMenuEC-Android/0.8.0" + (if (hasScreenLock) "" else " QRMenuEC-NoLock/")
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.saveFormData = false
            settings.safeBrowsingEnabled = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "https" && uri.host == platformHost) return false
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { progress.visibility = View.VISIBLE }
                override fun onPageFinished(view: WebView, url: String) {
                    progress.visibility = View.GONE
                    if (Uri.parse(url).host == platformHost && Uri.parse(url).getQueryParameter("remembered") == "1")
                        preferences.edit().putBoolean("entered", true).apply()
                    CookieManager.getInstance().flush()
                }
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
        }
        lockScreen = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setBackgroundColor(Color.rgb(28, 49, 37))
            setPadding(36, 36, 36, 36)
            addView(TextView(this@OwnerActivity).apply {
                text = "QR Menu EC\n\nDesbloquea tu celular para continuar"
                textSize = 22f
                setTextColor(Color.WHITE)
                gravity = android.view.Gravity.CENTER
            })
            addView(Button(this@OwnerActivity).apply {
                text = "Desbloquear"
                setOnClickListener { unlock() }
            })
        }
        setContentView(FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(-1, -1))
            addView(progress, FrameLayout.LayoutParams(-2, -2, android.view.Gravity.CENTER))
            addView(lockScreen, FrameLayout.LayoutParams(-1, -1))
        })
        if (preferences.getBoolean("entered", false)) unlock() else showWeb()
    }

    private fun showWeb() {
        awaitingUnlock = false
        prompting = false
        lockScreen.visibility = View.GONE
        if (firstLoad) { firstLoad = false; webView.loadUrl(ownerUrl) }
    }

    private fun unlock() {
        if (prompting) return
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        if (!keyguard.isDeviceSecure) {
            Toast.makeText(this, "Activa un bloqueo de pantalla para recordar este celular. Ingresa con tu contraseña.", Toast.LENGTH_LONG).show()
            preferences.edit().putBoolean("entered", false).apply()
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            webView.loadUrl(ownerUrl)
            firstLoad = false
            showWeb()
            return
        }
        awaitingUnlock = true
        lockScreen.visibility = View.VISIBLE
        prompting = true
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricPrompt.Builder(this)
                .setTitle("Desbloquear QR Menu EC")
                .setSubtitle("Usa tu huella, rostro o PIN")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build().authenticate(CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { showWeb() }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { prompting = false }
                })
        } else {
            val intent = keyguard.createConfirmDeviceCredentialIntent("Desbloquear QR Menu EC", "Usa el desbloqueo de tu celular")
            if (intent != null) startActivityForResult(intent, unlockRequest)
            else prompting = false
        }
    }

    override fun onStop() {
        super.onStop()
        if (preferences.getBoolean("entered", false) && !awaitingUnlock) {
            lastBackground = System.currentTimeMillis()
            lockScreen.visibility = View.VISIBLE
        }
    }

    override fun onResume() {
        super.onResume()
        if (lastBackground > 0L && !awaitingUnlock) {
            val elapsed = System.currentTimeMillis() - lastBackground
            lastBackground = 0L
            if (elapsed >= 60_000L) unlock() else lockScreen.visibility = View.GONE
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileRequest) {
            fileCallback?.onReceiveValue(if (resultCode == RESULT_OK) data?.data?.let { arrayOf(it) } else null)
            fileCallback = null
        }
        if (requestCode == unlockRequest) {
            if (resultCode == RESULT_OK) showWeb() else prompting = false
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() { if (awaitingUnlock) finish() else if (webView.canGoBack()) webView.goBack() else super.onBackPressed() }

    override fun onDestroy() { webView.destroy(); super.onDestroy() }
}
