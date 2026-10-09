plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { namespace="ec.qrmenu.app"; compileSdk=35
 defaultConfig { applicationId="ec.qrmenu.app"; minSdk=29; targetSdk=35; versionCode=16; versionName="0.8.5"
  buildConfigField("String", "PLATFORM_HOST", "\"qr-menu-ec.consola.workers.dev\"")
  manifestPlaceholders["appLabel"] = "QR Menu EC"
 }
 buildFeatures { buildConfig = true }
 compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget="17" }
 buildTypes {
  release { isMinifyEnabled=false }
  create("candidate") {
   initWith(getByName("release"))
   applicationIdSuffix = ".candidate"
   versionNameSuffix = "-candidate-59cf7bb8"
   buildConfigField("String", "PLATFORM_HOST", "\"59cf7bb8-qr-menu-ec.consola.workers.dev\"")
   manifestPlaceholders["appLabel"] = "QR Menu EC · PRUEBA"
   signingConfig = signingConfigs.getByName("debug")
   matchingFallbacks += listOf("release")
  }
 }
}
dependencies {
 testImplementation("junit:junit:4.13.2")
 implementation("androidx.core:core:1.15.0")
 implementation("com.google.firebase:firebase-messaging:25.1.3")
 implementation("androidx.webkit:webkit:1.12.1")
}
