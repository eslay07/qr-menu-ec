plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { namespace="ec.qrmenu.app"; compileSdk=35
 defaultConfig { applicationId="ec.qrmenu.app"; minSdk=29; targetSdk=35; versionCode=1; versionName="0.1.0-pilot" }
 compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget="17" }
 packaging { resources { excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF" } }
 buildTypes { release { isMinifyEnabled=false } }
}
dependencies { implementation("org.nanohttpd:nanohttpd:2.3.1"); implementation("org.bouncycastle:bcprov-jdk18on:1.80"); implementation("org.bouncycastle:bcpkix-jdk18on:1.80") }
