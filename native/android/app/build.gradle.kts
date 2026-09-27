plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { namespace="ec.qrmenu.app"; compileSdk=35
 defaultConfig { applicationId="ec.qrmenu.app"; minSdk=29; targetSdk=35; versionCode=11; versionName="0.8.0" }
 compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget="17" }
 buildTypes { release { isMinifyEnabled=false } }
}
