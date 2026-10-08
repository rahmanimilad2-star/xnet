package com.milad.vpn.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.core.content.ContextCompat
import com.milad.vpn.vpn.AppVpnService

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    private val vpnPermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        if (res.resultCode == RESULT_OK) AppVpnService.start(this)
    }
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // UI preferences (not sensitive) -> plain SharedPreferences
        val prefs = getSharedPreferences("ui_prefs", Context.MODE_PRIVATE)
        setContent {
            var english by remember { mutableStateOf(prefs.getBoolean("english", false)) }
            var darkMode by remember { mutableStateOf(prefs.getBoolean("dark_mode", true)) }
            // Draw behind system bars; bar icons follow the in-app dark mode.
            DisposableEffect(darkMode) {
                val transparent = android.graphics.Color.TRANSPARENT
                val style = if (darkMode) SystemBarStyle.dark(transparent) else SystemBarStyle.light(transparent, transparent)
                this@MainActivity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                onDispose { }
            }
            CompositionLocalProvider(LocalLayoutDirection provides if (english) LayoutDirection.Ltr else LayoutDirection.Rtl) {
                AppRoot(
                    vm = vm,
                    onStartVpn = ::startVpn,
                    english = english,
                    onLanguageChange = { english = it; prefs.edit().putBoolean("english", it).apply() },
                    darkMode = darkMode,
                    onDarkModeChange = { darkMode = it; prefs.edit().putBoolean("dark_mode", it).apply() },
                )
            }
        }
    }

    private fun startVpn() {
        val intent = VpnService.prepare(this)
        if (intent != null) vpnPermission.launch(intent) else AppVpnService.start(this)
    }
}
