plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Backend URL: -PvpnApiBaseUrl=... or env VPN_API_BASE_URL (CI), otherwise gradle.properties
val apiBase: String = System.getenv("VPN_API_BASE_URL")?.takeIf { it.isNotBlank() }
    ?: (project.findProperty("vpnApiBaseUrl") as String?) ?: "https://core.xnetify.ir"

android {
    namespace = "com.milad.vpn"
    compileSdk = 34
    buildToolsVersion = "34.0.0"

    defaultConfig {
        applicationId = "com.milad.vpn"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.1.0"
        buildConfigField("String", "API_BASE_URL", "\"${apiBase.trimEnd('/')}\"")
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }

    signingConfigs {
        create("release") {
            // مقادیر را در ~/.gradle/gradle.properties یا متغیر محیطی بگذارید، نه در مخزن
            val ks = System.getenv("VPN_KEYSTORE") ?: (project.findProperty("VPN_KEYSTORE") as String?)
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("VPN_KEYSTORE_PASSWORD") ?: project.findProperty("VPN_KEYSTORE_PASSWORD") as String?
                keyAlias = System.getenv("VPN_KEY_ALIAS") ?: project.findProperty("VPN_KEY_ALIAS") as String?
                keyPassword = System.getenv("VPN_KEY_PASSWORD") ?: project.findProperty("VPN_KEY_PASSWORD") as String?
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signingConfigs.getByName("release").storeFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    // هسته Xray: فایل libv2ray.aar از پروژه AndroidLibXrayLite را در app/libs قرار دهید (راهنما: app/libs/README.md)
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar", "*.jar"))))

    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.google.errorprone:error_prone_annotations:2.36.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
