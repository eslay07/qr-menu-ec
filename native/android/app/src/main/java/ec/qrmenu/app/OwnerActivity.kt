package ec.qrmenu.app

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class OwnerActivity : Activity() {
    private val updater by lazy { OwnerUpdater(this, platformHost) { !isFinishing && !isDestroyed && !awaitingUnlock && lockScreen.visibility == View.GONE } }
    private var pushBridge: OwnerPushBridge? = null
    private var printBridge: OwnerPrintBridge? = null
    private var backCallback: OnBackInvokedCallback? = null
    private var handlingBack = false
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val fileRequest = 701
    private val unlockRequest = 702
    private val platformHost = BuildConfig.PLATFORM_HOST
    private val ownerUrl get() = "https://$platformHost/owner"
    private lateinit var lockScreen: LinearLayout
    private var lastBackground = 0L
    private var awaitingUnlock = false
    private var firstLoad = true
    private var pendingNotification: String? = null
    private fun notificationUrl(intent: Intent?): String? {
        val uri = intent?.data ?: return null
        if (!uri.isHierarchical) return null
        val event = uri.getQueryParameter("notification") ?: return null
        val restaurant = uri.getQueryParameter("restaurant") ?: return null
        if (uri.scheme != "https" || uri.host != platformHost || !Regex("[a-zA-Z0-9_-]{1,100}").matches(event) || !Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}").matches(restaurant)) return null
        return "https://$platformHost/r/$restaurant/?notification=$event&restaurant=$restaurant"
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingNotification = notificationUrl(intent)
        if (!awaitingUnlock && lockScreen.visibility == View.GONE) showWeb()
    }
    private var prompting = false
    private var biometricCancellation: CancellationSignal? = null
    private var requestUnlockOnResume = false
    private val preferences by lazy { getSharedPreferences("owner_access", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = OnBackInvokedCallback { handleBack() }.also {
                onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, it)
            }
        }
        pendingNotification = notificationUrl(intent)
        val progress = ProgressBar(this).apply { visibility = View.GONE }
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            pushBridge = OwnerPushBridge(this@OwnerActivity, this, platformHost).also { it.attach() }
            printBridge = OwnerPrintBridge(this@OwnerActivity, this, platformHost).also { it.attach() }
            val hasScreenLock = (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure
            settings.userAgentString = settings.userAgentString + " QRMenuEC-Android/${BuildConfig.VERSION_NAME}" + (if (hasScreenLock) "" else " QRMenuEC-NoLock/")
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
                    if (BuildConfig.BUILD_TYPE == "candidate") {
                        Toast.makeText(this@OwnerActivity, "Prueba aislada: enlace externo bloqueado", Toast.LENGTH_LONG).show()
                        return true
                    }
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { progress.visibility = View.VISIBLE }
                override fun onPageFinished(view: WebView, url: String) {
                    progress.visibility = View.GONE
                    printBridge?.onPageFinished(url)
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
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
            addView(webView, FrameLayout.LayoutParams(-1, -1))
            addView(progress, FrameLayout.LayoutParams(-2, -2, android.view.Gravity.CENTER))
            addView(lockScreen, FrameLayout.LayoutParams(-1, -1))
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(root)
        WindowCompat.getInsetsController(window, root).apply { isAppearanceLightStatusBars = true; isAppearanceLightNavigationBars = true }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            val safe = safeArea(SafeArea(bars.left, bars.top, bars.right, bars.bottom), SafeArea(cutout.left, cutout.top, cutout.right, cutout.bottom), insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)
        // A cold start must not launch authentication before the Activity is
        // resumed. Keep the opaque lock screen visible while Android starts.
        if (preferences.getBoolean("entered", false)) {
            awaitingUnlock = true
            requestUnlockOnResume = true
        } else showWeb()
    }

    private fun showWeb() {
        awaitingUnlock = false
        prompting = false
        lockScreen.visibility = View.GONE
        updater.check()
        updater.installPending()
        if (pendingNotification != null) { firstLoad = false; webView.loadUrl(pendingNotification!!); pendingNotification = null }
        else if (firstLoad) { firstLoad = false; webView.loadUrl(ownerUrl) }
    }

    private fun unlock() {
        if (prompting) return
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        if (!keyguard.isDeviceSecure) {
            Toast.makeText(this, "Activa un bloqueo de pantalla para recordar este celular. Ingresa con tu contraseña.", Toast.LENGTH_LONG).show()
            preferences.edit().putBoolean("entered", false).apply()
            CookieManager.getInstance().removeAllCookies {
                if (!isFinishing && !isDestroyed) {
                    CookieManager.getInstance().flush()
                    firstLoad = true
                    webView.clearHistory()
                    showWeb()
                }
            }
            return
        }
        awaitingUnlock = true
        lockScreen.visibility = View.VISIBLE
        prompting = true
        try {
        if (Build.VERSION.SDK_INT >= 30) {
            biometricCancellation = CancellationSignal()
            BiometricPrompt.Builder(this)
                .setTitle("Desbloquear QR Menu EC")
                .setSubtitle("Usa tu huella, rostro o PIN")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build().authenticate(biometricCancellation!!, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (!isFinishing && !isDestroyed) showWeb()
                    }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        prompting = false
                        if (!isFinishing && !isDestroyed) Toast.makeText(this@OwnerActivity, "No se desbloqueó. Pulsa Desbloquear para intentarlo de nuevo.", Toast.LENGTH_LONG).show()
                    }
                })
        } else {
            unlockWithCredential(keyguard)
        }
        } catch (_: RuntimeException) {
            // Missing/unavailable biometric services must never crash startup
            // or reveal the protected WebView. PIN/password is the fallback.
            unlockWithCredential(keyguard)
        }
    }

    private fun unlockWithCredential(keyguard: KeyguardManager) {
        try {
            val intent = keyguard.createConfirmDeviceCredentialIntent("Desbloquear QR Menu EC", "Usa el desbloqueo de tu celular")
            if (intent != null) startActivityForResult(intent, unlockRequest)
            else throw IllegalStateException("Device credential unavailable")
        } catch (_: RuntimeException) {
            prompting = false
            lockScreen.visibility = View.VISIBLE
            Toast.makeText(this, "No se pudo abrir el desbloqueo del sistema. Revisa el bloqueo de pantalla y vuelve a intentarlo.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onStop() {
        updater.background()
        updater.hide()
        super.onStop()
        if (preferences.getBoolean("entered", false) && !awaitingUnlock) {
            lastBackground = System.currentTimeMillis()
            lockScreen.visibility = View.VISIBLE
        }
    }

    override fun onResume() {
        super.onResume()
        if (::lockScreen.isInitialized && lockScreen.visibility == View.GONE) { updater.check(); updater.installPending() }
        if (requestUnlockOnResume && !prompting) {
            requestUnlockOnResume = false
            unlock()
            return
        }
        if (lastBackground > 0L && !awaitingUnlock) {
            val elapsed = System.currentTimeMillis() - lastBackground
            lastBackground = 0L
            if (elapsed >= 60_000L) unlock() else showWeb()
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 703) pushBridge?.permissionResult()
    }

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
    override fun onBackPressed() { handleBack() }

    private fun handleBack() {
        if (awaitingUnlock || lockScreen.visibility != View.GONE) { finish(); return }
        if (handlingBack || isFinishing || isDestroyed) return
        val uri = Uri.parse(webView.url ?: "")
        if (uri.scheme != "https" || uri.host != platformHost) { fallbackBack(); return }
        handlingBack = true
        // The page consumes modal closure or a React history step synchronously.
        // Never invoke the page while the local protection screen is visible.
        webView.evaluateJavascript("(function(){return typeof window.qrMenuHandleBack==='function' && window.qrMenuHandleBack()===true;})()") { handled ->
            handlingBack = false
            if (!isFinishing && !isDestroyed && !awaitingUnlock && lockScreen.visibility == View.GONE && handled != "true") fallbackBack()
        }
    }

    private fun fallbackBack() {
        if (webView.canGoBack()) webView.goBack() else finish()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        backCallback = null
        updater.destroy()
        biometricCancellation?.cancel()
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
