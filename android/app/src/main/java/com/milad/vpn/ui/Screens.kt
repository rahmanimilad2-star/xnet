package com.milad.vpn.ui

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.milad.vpn.R
import com.milad.vpn.data.Account
import com.milad.vpn.data.VpnConfig
import com.milad.vpn.vpn.Phase
import com.milad.vpn.vpn.VpnStatus
import kotlinx.coroutines.delay

// ------------------------------------------------------------------------------------ tokens
private const val DEVELOPER_NAME = "M.R"
private const val APP_TITLE = "Xnet"

private val CardShape = RoundedCornerShape(18.dp)
private val HomeCardShape = RoundedCornerShape(16.dp)

// ---------------------------------------------------------------------------------- haptics
private var lastVibrationAt = 0L

/** Short, subtle tick; [strong] only for connect/disconnect. Rate-limited, never continuous. */
private fun vibrate(context: Context, strong: Boolean = false) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastVibrationAt < 80) return
    lastVibrationAt = now
    try {
        val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
        if (vibrator == null || !vibrator.hasVibrator()) return
        val amplitude = if (vibrator.hasAmplitudeControl()) (if (strong) 120 else 60) else VibrationEffect.DEFAULT_AMPLITUDE
        vibrator.vibrate(VibrationEffect.createOneShot(if (strong) 35L else 15L, amplitude))
    } catch (_: Exception) {
    }
}

// ------------------------------------------------------------------------------------- root
@Composable
fun AppRoot(
    vm: MainViewModel,
    onStartVpn: () -> Unit,
    english: Boolean,
    onLanguageChange: (Boolean) -> Unit,
    darkMode: Boolean,
    onDarkModeChange: (Boolean) -> Unit,
) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    AppTheme(darkTheme = darkMode) {
        if (!ui.loggedIn) {
            LoginScreen(loading = ui.loading, error = if (english && ui.loginErrorCode == "ALREADY_ACTIVE") "This account is already active on another device." else ui.loginError, english = english, onLogin = vm::login)
        } else {
            MainScaffold(vm, ui, onStartVpn, english, darkMode, onLanguageChange, onDarkModeChange)
        }
    }
}

// ------------------------------------------------------------------------------------ login
@Composable
fun LoginScreen(loading: Boolean, error: String?, english: Boolean, onLogin: (String, String) -> Unit) {
    var user by rememberSaveable { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    val context = LocalContext.current

    Box(Modifier.fillMaxSize()) {
        HomeBackdrop(Cyan, 0.6f)
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(56.dp))
            Box(
                Modifier
                    .size(76.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .border(1.dp, Cyan.copy(alpha = 0.5f), RoundedCornerShape(24.dp)),
                contentAlignment = Alignment.Center,
            ) { Image(painterResource(R.drawable.xnet_logo), contentDescription = null, modifier = Modifier.size(46.dp)) }
            Spacer(Modifier.height(14.dp))
            Text(APP_TITLE.uppercase(), color = MaterialTheme.colorScheme.onSurface, fontSize = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = if (english) 6.sp else 2.sp)
            Text(
                if (english) "SECURE VPN" else "وی‌پی‌ان امن",
                color = muted(), fontSize = 14.sp,
            )
            Spacer(Modifier.height(30.dp))

            Surface(
                shape = RoundedCornerShape(26.dp),
                color = MaterialTheme.colorScheme.surface,
                border = glassBorder(),
                modifier = Modifier.fillMaxWidth().widthIn(max = 420.dp),
            ) {
                Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(if (english) "Sign in" else "ورود به حساب", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(
                        if (english) "Use the account your provider gave you." else "با حسابی که مدیر برایتان ساخته وارد شوید.",
                        color = muted(), fontSize = 13.sp,
                    )
                    OutlinedTextField(
                        value = user, onValueChange = { user = it },
                        label = { Text(if (english) "Username" else "نام کاربری") },
                        leadingIcon = { Icon(Icons.Filled.Person, null) },
                        singleLine = true, shape = RoundedCornerShape(14.dp), colors = xnetFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                    )
                    OutlinedTextField(
                        value = pass, onValueChange = { pass = it },
                        label = { Text(if (english) "Password" else "رمز عبور") },
                        leadingIcon = { Icon(Icons.Filled.Lock, null) },
                        singleLine = true, shape = RoundedCornerShape(14.dp), colors = xnetFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        trailingIcon = {
                            IconButton(onClick = { vibrate(context); show = !show }) {
                                Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, null)
                            }
                        },
                    )
                    AnimatedVisibility(visible = error != null, enter = fadeIn(), exit = fadeOut()) {
                        Surface(color = Bad.copy(alpha = 0.12f), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.ErrorOutline, null, tint = Bad, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(error.orEmpty(), color = Bad, fontSize = 13.sp)
                            }
                        }
                    }
                    GradientButton(
                        text = if (english) "Sign in" else "ورود",
                        loading = loading,
                        onClick = { vibrate(context); onLogin(user, pass) },
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun GradientButton(text: String, loading: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = if (loading) 0.6f else 1f))
            .clickable(enabled = !loading, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(22.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        else Text(text, color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

// ------------------------------------------------------------------------------------ shell
@Composable
fun MainScaffold(
    vm: MainViewModel,
    ui: UiState,
    onStartVpn: () -> Unit,
    english: Boolean,
    darkMode: Boolean,
    onLanguageChange: (Boolean) -> Unit,
    onDarkModeChange: (Boolean) -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val vpn by vm.vpn.collectAsStateWithLifecycle()
    val snack = remember { SnackbarHostState() }
    val context = LocalContext.current

    LaunchedEffect(ui.info) { ui.info?.let { snack.showSnackbar(it) } }
    LaunchedEffect(vpn.error) {
        vpn.error?.let { snack.showSnackbar(if (vpn.isQuotaExceeded) (if (english) VpnStatus.QUOTA_MESSAGE_EN else VpnStatus.QUOTA_MESSAGE_FA) else it) }
    }
    LaunchedEffect(vpn.stopCode) { if (vpn.stopCode != null) vm.refreshNow() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = {
            SnackbarHost(snack) { data ->
                Snackbar(
                    data, shape = RoundedCornerShape(14.dp),
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    actionColor = MaterialTheme.colorScheme.primary,
                )
            }
        },
        // xnet-ui-polish-v1: we handle system bars ourselves (edge-to-edge)
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = { XnetBottomBar(tab, english) { index -> if (tab != index) { vibrate(context); tab = index } } },
    ) { pad ->
        Box(
            Modifier.padding(pad).fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
                // Home paints its background behind the status bar and pads its own content
                .then(if (tab == 0) Modifier else Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))),
        ) {
            if (tab != 0) HomeBackdrop(Cyan, 0.4f)
            when (tab) {
                0 -> HomeScreen(ui, vpn, english, onOpenServers = { tab = 1 }, onOpenAccount = { tab = 2 }) { vm.toggle(onStartVpn) }
                1 -> ServersScreen(ui, english, vm::selectConfig, connectedId = if (vpn.phase == Phase.CONNECTED) vpn.configId else null, pingMs = vpn.pingMs)
                else -> AccountScreen(
                    acc = ui.account, english = english, darkMode = darkMode,
                    supportTelegram = ui.supportTelegram,
                    password = remember(ui.account?.username) { com.milad.vpn.data.Repository.session.password },
                    onLanguageChange = onLanguageChange, onDarkModeChange = onDarkModeChange,
                    onRefresh = vm::refreshAccountNow, onLogout = vm::logout,
                )
            }
        }
    }
}

/** Floating bottom navigation: filled icon on a soft pill when selected, outlined + muted otherwise. */
@Composable
private fun XnetBottomBar(tab: Int, english: Boolean, onSelect: (Int) -> Unit) {
    val labels = if (english) listOf("Home", "Servers", "Account") else listOf("خانه", "سرورها", "حساب")
    val filled = listOf(Icons.Filled.Home, Icons.Filled.Public, Icons.Filled.Person)
    // Keep the same stable icons in both states. The current project dependency set
    // does not expose the outlined Home/Public variants on GitHub Actions.
    val outlined = listOf(Icons.Filled.Home, Icons.Filled.Public, Icons.Filled.Person)
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background),
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.8f))
        Box(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .padding(horizontal = 14.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
          Box(Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
            Row(Modifier.height(68.dp).padding(horizontal = 6.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                labels.forEachIndexed { i, label ->
                    val sel = tab == i
                    val tint by animateColorAsState(if (sel) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, tween(220), label = "navTint")
                    val pill by animateColorAsState(
                        if (sel) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else Color.Transparent, tween(220), label = "navPill",
                    )
                    Column(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(18.dp))
                            .selectable(selected = sel, role = Role.Tab, onClick = { onSelect(i) }),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Box(
                            Modifier
                                .size(width = 56.dp, height = 32.dp)
                                .clip(RoundedCornerShape(50))
                                .background(pill)
                                .border(1.dp, if (sel) tint.copy(alpha = 0.55f) else Color.Transparent, RoundedCornerShape(50)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                if (sel) filled[i] else outlined[i],
                                contentDescription = null,
                                tint = tint,
                                modifier = Modifier.size(if (sel) 24.dp else 21.dp),
                            )
                        }
                        Spacer(Modifier.height(2.dp))
                        Text(
                            label,
                            color = tint,
                            fontSize = 11.sp,
                            fontWeight = if (sel) FontWeight.Bold else FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
          }
        }
    }
}



// ------------------------------------------------------------------------------------- home
private data class PhaseLook(val label: String, val color: Color, val deep: Color)

private fun phaseLook(vpn: VpnStatus, english: Boolean): PhaseLook = if (vpn.phase == Phase.DISCONNECTED && vpn.isQuotaExceeded) {
    PhaseLook(if (english) "Data used up" else "حجم تمام شد", Bad, Color(0xFFB91C1C))
} else if (vpn.isError) {
    PhaseLook(if (english) "Connection failed" else "خطا در اتصال", Bad, Color(0xFFB91C1C))
} else when (vpn.phase) {
    Phase.CONNECTED -> PhaseLook(if (english) "Connected" else "متصل", Cyan, CyanDeep)
    Phase.CONNECTING -> PhaseLook(if (english) "Connecting…" else "در حال اتصال…", Warn, Color(0xFFEA580C))
    Phase.RECONNECTING -> PhaseLook(if (english) "Reconnecting…" else "در حال اتصال مجدد…", Warn, Color(0xFFEA580C))
    Phase.DISCONNECTED -> PhaseLook(if (english) "Disconnected" else "قطع", Steel, SteelDeep)
}

@Composable
fun HomeScreen(ui: UiState, vpn: VpnStatus, english: Boolean, onOpenServers: () -> Unit, onOpenAccount: () -> Unit = {}, onToggle: () -> Unit) {
    val look = phaseLook(vpn, english)
    val accent by animateColorAsState(look.color, tween(420), label = "homeAccent")
    val selected = ui.configs.firstOrNull { it.id == ui.selectedConfigId }
    val connected = if (vpn.phase == Phase.CONNECTED) ui.configs.firstOrNull { it.id == vpn.configId } else null
    val shown = selected ?: connected
    val serverName = shown?.name ?: if (ui.selectedConfigId < 0) (if (english) "Auto" else "خودکار") else (if (english) "Selected server" else "سرور انتخاب‌شده")
    val serverSub = listOfNotNull(
        shown?.country?.takeIf { it.isNotBlank() },
        shown?.protocol?.uppercase()?.takeIf { it.isNotBlank() },
    ).joinToString(" · ").ifBlank { if (english) "Automatic server selection" else "انتخاب خودکار سرور" }
    val hint = when (vpn.phase) {
        Phase.DISCONNECTED -> when {
            vpn.isQuotaExceeded || ui.blockCode == "QUOTA_EXCEEDED" -> if (english) VpnStatus.QUOTA_MESSAGE_EN else VpnStatus.QUOTA_MESSAGE_FA
            vpn.isError -> if (english) "Tap to try again" else "برای تلاش دوباره لمس کنید"
            else -> if (english) "Tap to connect securely" else "برای اتصال امن لمس کنید"
        }
        Phase.CONNECTING, Phase.RECONNECTING -> vpn.detail?.takeIf { !english } ?: if (english) "Please wait…" else "لطفاً صبر کنید…"
        Phase.CONNECTED -> if (english) "Connected to $serverName" else "متصل به $serverName"
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        HomeBackdrop(accent, if (vpn.phase == Phase.CONNECTED) 0.78f else 0.28f)
        val viewportHeight = this@BoxWithConstraints.maxHeight
        val short = viewportHeight < 650.dp
        Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 520.dp).fillMaxWidth().heightIn(min = viewportHeight), horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height(if (short) 12.dp else 22.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(APP_TITLE.uppercase(), color = MaterialTheme.colorScheme.onSurface, fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = if (english) 6.sp else 2.sp)
                        Text(if (english) "SECURE VPN" else "وی‌پی‌ان امن", color = muted(), fontSize = 10.sp, letterSpacing = if (english) 3.sp else 0.sp)
                    }
                    StatusChip(look.label, english, onDark = true)
                }
                ui.blockMessage?.let { Spacer(Modifier.height(10.dp)); Banner(if (ui.blockCode == "QUOTA_EXCEEDED") (if (english) VpnStatus.QUOTA_MESSAGE_EN else VpnStatus.QUOTA_MESSAGE_FA) else it, Bad) }
                Spacer(Modifier.height(if (short) 12.dp else 26.dp))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    ConnectButton(vpn.phase, look, onToggle, buttonSize = if (short) 210.dp else 264.dp)
                    Spacer(Modifier.height(14.dp))
                    Text(if (english) look.label.uppercase() else look.label, color = accent, fontSize = 19.sp, fontWeight = FontWeight.Bold, letterSpacing = if (english) 3.sp else 0.sp)
                    if (vpn.phase == Phase.CONNECTED) {
                        var tick by remember { mutableIntStateOf(0) }
                        LaunchedEffect(Unit) { while (true) { delay(1000); tick++ } }
                        key(tick) { Text(Format.duration(vpn.connectedSince), color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(hint, color = muted(), fontSize = 12.sp, textAlign = TextAlign.Center, maxLines = 2)
                }
                Spacer(Modifier.height(if (short) 18.dp else 28.dp))
                ServerCard(flagOf(shown?.country ?: ""), serverName, serverSub, accent, english, onOpenServers)
                Spacer(Modifier.height(14.dp))
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surface.copy(alpha = 0.72f)).border(1.dp, MaterialTheme.colorScheme.outline), verticalAlignment = Alignment.CenterVertically) {
                    HomeStat(if (english) "PING" else "پینگ", vpn.pingMs?.let { "${Format.num(it)} ms" } ?: "—", Modifier.weight(1f))
                    VerticalDivider(Modifier.height(30.dp), color = MaterialTheme.colorScheme.outline)
                    HomeStat(if (english) "PROTOCOL" else "پروتکل", shown?.protocol?.uppercase()?.takeIf { it.isNotBlank() } ?: "—", Modifier.weight(1f))
                }
                ui.account?.let { Spacer(Modifier.height(14.dp)); SubscriptionStrip(it, ui.subscriptionUsage, english, onOpenAccount) }
                Spacer(Modifier.height(18.dp))
            }
        }
    }
}

@Composable
private fun HomeStat(title: String, value: String, modifier: Modifier) {
    Column(modifier.padding(vertical = 11.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = muted(), fontSize = 10.sp, letterSpacing = 1.5.sp)
        Text(value, color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ServerCard(flag: String, title: String, sub: String, accent: Color, english: Boolean, onClick: () -> Unit) {
    val context = LocalContext.current
    Surface(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).clickable { vibrate(context); onClick() },
        shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface, border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline), shadowElevation = 0.dp,
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(accent.copy(alpha = 0.10f)).border(1.dp, accent.copy(alpha = 0.35f), RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Language, null, tint = accent, modifier = Modifier.size(23.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(sub, color = muted(), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, if (english) "Change server" else "تغییر سرور", tint = muted(), modifier = Modifier.size(22.dp))
        }
    }
}

@Composable
private fun ConnectButton(phase: Phase, look: PhaseLook, onClick: () -> Unit, buttonSize: Dp = 250.dp) {
    val context = LocalContext.current
    val c1 by animateColorAsState(look.color, tween(420), label = "buttonAccent")
    val c2 by animateColorAsState(look.deep, tween(420), label = "buttonDeep")
    val busy = phase == Phase.CONNECTING || phase == Phase.RECONNECTING
    val connected = phase == Phase.CONNECTED
    val transition = rememberInfiniteTransition(label = "connectionRings")
    val phaseSweep by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "phaseSweep")
    val ripple by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(2600, easing = LinearEasing)), label = "ripple")
    var pressed by remember { mutableStateOf(false) }
    val pressScale by animateFloatAsState(if (pressed) 0.94f else 1f, tween(120), label = "pressScale")
    LaunchedEffect(pressed) { if (pressed) { delay(140); pressed = false } }
    Box(Modifier.size(buttonSize), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val outer = size.minDimension * 0.47f
            val inner = size.minDimension * 0.31f
            drawCircle(Brush.radialGradient(listOf(c1.copy(alpha = if (connected) 0.20f else 0.07f), Color.Transparent), center, outer * 1.65f), outer * 1.65f, center)
            drawCircle(c1.copy(alpha = 0.12f), outer * 1.22f, center, style = Stroke(1.5f))
            drawCircle(c1.copy(alpha = if (connected) 0.50f else 0.24f), outer * 1.02f, center, style = Stroke(2f))
            drawCircle(c1.copy(alpha = 0.16f), outer * 0.83f, center, style = Stroke(1f))
            if (busy) {
                drawArc(c1.copy(alpha = 0.9f), phaseSweep, 85f, false, Offset(center.x - outer, center.y - outer), androidx.compose.ui.geometry.Size(outer * 2f, outer * 2f), style = Stroke(4f, cap = StrokeCap.Round))
                drawCircle(c1.copy(alpha = (1f - ripple) * 0.35f), inner + (outer - inner) * ripple, center, style = Stroke(2f))
            }
        }
        Box(
            Modifier.size(buttonSize * 0.62f).scale(pressScale).clip(CircleShape)
                .background(Brush.radialGradient(listOf(c2.copy(alpha = if (connected) 0.85f else 0.55f), MaterialTheme.colorScheme.surface)))
                .border(if (connected) 3.dp else 2.dp, c1.copy(alpha = if (connected) 0.95f else 0.65f), CircleShape)
                .clickable { pressed = true; vibrate(context, strong = true); onClick() },
            contentAlignment = Alignment.Center,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(buttonSize * 0.21f), color = c1, strokeWidth = 3.dp)
            else Icon(if (connected) Icons.Filled.VerifiedUser else Icons.Filled.PowerSettingsNew, null, tint = if (connected) MaterialTheme.colorScheme.onSurface else c1, modifier = Modifier.size(buttonSize * 0.25f))
        }
    }
}

@Composable
private fun StatCard(title: String, value: String, icon: ImageVector, tint: Color, modifier: Modifier) {
    Row(modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(tint.copy(alpha = 0.13f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.width(9.dp))
        Column {
            Text(title, fontSize = 11.sp, color = muted(), lineHeight = 14.sp, maxLines = 1)
            Text(value, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, lineHeight = 19.sp)
        }
    }
}

// ------------------------------------------------------------ subscription (xnet-subscription-v1)
// All values come from the signed-in user's /account response; the password is the one this
// device logged in with (encrypted in SessionStore). Nothing here is hard-coded.
private fun planLabel(acc: Account, english: Boolean): String {
    val sub = acc.subscriptionUsage
    return if (sub != null) {
        if (sub.unlimited || sub.totalBytes <= 0) {
            if (english) "Unlimited" else "نامحدود"
        } else {
            "${Format.bytes(sub.totalBytes)} · ${if (english) "Data plan" else "حجمی"}"
        }
    } else if (acc.unlimited || acc.quotaBytes <= 0) {
        if (english) "Unlimited" else "نامحدود"
    } else {
        "${Format.bytes(acc.quotaBytes)} · ${if (english) "Data plan" else "حجمی"}"
    }
}

private fun statusColor(status: String): Color = when (status) {
    "ACTIVE" -> Ok
    "BLOCKED" -> Bad
    else -> Warn
}

private fun statusShort(status: String, english: Boolean): String = when (status) {
    "ACTIVE" -> if (english) "Active" else "فعال"
    "EXPIRED" -> if (english) "Expired" else "منقضی"
    "QUOTA_EXCEEDED" -> if (english) "Limit reached" else "اتمام حجم"
    "BLOCKED" -> if (english) "Blocked" else "مسدود"
    else -> status
}

private fun expiryLine(acc: Account, english: Boolean): String {
    if (acc.expiresAt == null) return if (english) "No expiry" else "بدون محدودیت زمانی"
    val d = acc.daysLeft
    val left = when {
        d == null -> ""
        acc.status == "EXPIRED" || d <= 0 -> if (english) " · expired" else " · منقضی شده"
        else -> if (english) " · $d days left" else " · ${Format.num(d)} روز مانده"
    }
    return "${if (english) "Expires" else "انقضا"} ${Format.date(acc.expiresAt)}$left"
}

private fun copyToClipboard(context: Context, label: String, text: String, sensitive: Boolean, english: Boolean) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager ?: return
    val clip = android.content.ClipData.newPlainText(label, text)
    if (sensitive) {
        clip.description.extras = android.os.PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
        }
    }
    cm.setPrimaryClip(clip)
    // Android 13+ shows its own copy confirmation.
    if (Build.VERSION.SDK_INT < 33) {
        android.widget.Toast.makeText(context, if (english) "Copied" else "کپی شد", android.widget.Toast.LENGTH_SHORT).show()
    }
}

@Composable
private fun StatusChip(status: String, english: Boolean, onDark: Boolean = false) {
    val c = statusColor(status)
    Surface(
        color = if (onDark) Color.White.copy(alpha = 0.18f) else c.copy(alpha = 0.14f),
        shape = RoundedCornerShape(50),
    ) {
        Row(Modifier.padding(horizontal = 11.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(c))
            Spacer(Modifier.width(6.dp))
            Text(
                statusShort(status, english), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                color = if (onDark) Color.White else c,
            )
        }
    }
}

@Composable
private fun DetailRow(
    icon: ImageVector,
    label: String,
    value: String,
    valueColor: Color = Color.Unspecified,
    ltr: Boolean = false,
    mono: Boolean = false,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(34.dp).clip(RoundedCornerShape(11.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 12.sp, color = muted())
            Text(
                value,
                fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = valueColor,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontFamily = if (mono) androidx.compose.ui.text.font.FontFamily.Monospace else null,
                style = if (ltr) androidx.compose.ui.text.TextStyle(textDirection = androidx.compose.ui.text.style.TextDirection.Ltr)
                        else androidx.compose.ui.text.TextStyle.Default,
            )
        }
        if (trailing != null) Row(verticalAlignment = Alignment.CenterVertically, content = trailing)
    }
}

/** Account: one intentional block replacing the old profile header + traffic cards. */
@Composable
fun SubscriptionPanel(acc: Account, password: String?, english: Boolean) {
    val context = LocalContext.current
    var reveal by rememberSaveable { mutableStateOf(false) }
    Surface(
        Modifier.fillMaxWidth(),
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = glassBorder(),
        shadowElevation = 0.dp,
    ) {
        // header: identity + status
        Row(
            Modifier.fillMaxWidth()
                .background(Brush.horizontalGradient(listOf(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f), Color.Transparent)))
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)).border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.5f), CircleShape), contentAlignment = Alignment.Center) {
                Text(acc.username.take(1).uppercase(), color = MaterialTheme.colorScheme.primary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(if (english) "Subscription details" else "مشخصات اشتراک", color = MaterialTheme.colorScheme.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(statusText(acc.status, english), color = muted(), fontSize = 12.sp)
            }
            StatusChip(acc.status, english)
        }
        Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
            DetailRow(Icons.Filled.Person, if (english) "User ID" else "شناسه کاربری", acc.username, ltr = true) {
                IconButton(onClick = { vibrate(context); copyToClipboard(context, "username", acc.username, false, english) }) {
                    Icon(Icons.Filled.ContentCopy, if (english) "Copy" else "کپی", tint = muted(), modifier = Modifier.size(18.dp))
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
            if (password != null) {
                DetailRow(
                    Icons.Filled.Key, if (english) "Password" else "رمز عبور",
                    if (reveal) password else "••••••••", ltr = true, mono = reveal,
                ) {
                    if (reveal) {
                        IconButton(onClick = { vibrate(context); copyToClipboard(context, "password", password, true, english) }) {
                            Icon(Icons.Filled.ContentCopy, if (english) "Copy" else "کپی", tint = muted(), modifier = Modifier.size(18.dp))
                        }
                    }
                    IconButton(onClick = { vibrate(context); reveal = !reveal }) {
                        Icon(
                            if (reveal) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            if (reveal) (if (english) "Hide" else "پنهان") else (if (english) "Show" else "نمایش"),
                            tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp),
                        )
                    }
                }
            } else {
                DetailRow(
                    Icons.Filled.Key, if (english) "Password" else "رمز عبور",
                    if (english) "Sign in again once to view" else "برای نمایش، یک‌بار دوباره وارد شوید",
                    valueColor = muted(),
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
            DetailRow(Icons.Filled.WorkspacePremium, if (english) "Plan" else "پلن", planLabel(acc, english))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
            DetailRow(
                Icons.Filled.Event, if (english) "Validity" else "اعتبار", expiryLine(acc, english),
                valueColor = if (acc.expiresAt != null && (acc.daysLeft ?: 99) <= 3) Bad else Color.Unspecified,
            )
        }
    }
}

/** Home: subscription usage card (no credentials). Data = the refreshed [Account]; tap opens Account. */
@Composable
fun SubscriptionStrip(
    acc: Account,
    subscriptionUsage: List<com.milad.vpn.data.SubscriptionItemUsage>,
    english: Boolean,
    onOpen: () -> Unit,
) {
    val context = LocalContext.current

    // This is the authenticated user's subscription_usage from /api/v1/configs.
    // RefreshAccountNow() refreshes this data online before calling refresh().
    val sub = subscriptionUsage.singleOrNull()

    val totalBytes = sub?.totalBytes
    val usedBytes = sub?.usedBytes

    val volume = if (totalBytes != null && usedBytes != null) {
        if (totalBytes <= 0L) {
            SubscriptionUsage.Volume.Unlimited(usedBytes)
        } else {
            val remainingBytes = sub?.remainingBytes ?: (totalBytes - usedBytes).coerceAtLeast(0L)
            SubscriptionUsage.Volume.Limited(
                usedBytes = usedBytes,
                quotaBytes = totalBytes,
                remainingBytes = remainingBytes,
            )
        }
    } else {
        SubscriptionUsage.Volume.Unknown
    }

    val time = sub?.expireAt?.let { expireAt ->
        val now = System.currentTimeMillis()
        if (expireAt <= now) {
            SubscriptionUsage.Time.Expired
        } else {
            val days = kotlin.math.ceil(
                (expireAt - now) / 86_400_000.0
            ).toInt().coerceAtLeast(1)
            SubscriptionUsage.Time.DaysLeft(days)
        }
    } ?: SubscriptionUsage.Time.NoLimit

    val hasLimitedVolume = volume is SubscriptionUsage.Volume.Limited
    val usedFraction = (volume as? SubscriptionUsage.Volume.Limited)?.usedFraction ?: 0f

    val volumeTitle = when (volume) {
        SubscriptionUsage.Volume.Unknown -> if (english) "Subscription usage" else "مصرف اشتراک"
        is SubscriptionUsage.Volume.Unlimited -> if (english) "Unlimited" else "نامحدود"
        is SubscriptionUsage.Volume.Limited -> Format.bytes(volume.remainingBytes)
    }

    val volumeSubtitle = when (volume) {
        SubscriptionUsage.Volume.Unknown -> if (english) "Usage not available" else "حجم نامشخص"
        is SubscriptionUsage.Volume.Unlimited -> if (english) "Unlimited volume" else "حجم نامحدود"
        is SubscriptionUsage.Volume.Limited ->
            if (english) "${Format.bytes(volume.remainingBytes)} remaining of ${Format.bytes(volume.quotaBytes)}"
            else "${Format.bytes(volume.remainingBytes)} باقی‌مانده از ${Format.bytes(volume.quotaBytes)}"
    }

    val daysText = when (time) {
        SubscriptionUsage.Time.NoLimit -> null
        SubscriptionUsage.Time.Expired -> if (english) "Expired" else "منقضی شده"
        is SubscriptionUsage.Time.DaysLeft ->
            if (english) "⏳ ${time.days} days left"
            else "⏳ ${Format.num(time.days)} روز باقی‌مانده"
    }

    val daysColor = when (time) {
        SubscriptionUsage.Time.Expired -> Bad
        is SubscriptionUsage.Time.DaysLeft -> if (time.days <= 3) Bad else muted()
        SubscriptionUsage.Time.NoLimit -> muted()
    }

    Surface(
        Modifier
            .fillMaxWidth()
            .clip(CardShape)
            .clickable {
                vibrate(context)
                onOpen()
            },
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        border = glassBorder(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(Brand, BrandDeep)
                            )
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.WorkspacePremium,
                        null,
                        tint = Color.White,
                        modifier = Modifier.size(20.dp),
                    )
                }

                Spacer(Modifier.width(12.dp))

                Column(Modifier.weight(1f)) {
                    Text(
                        if (english) "Subscription usage" else "مصرف اشتراک",
                        color = muted(),
                        maxLines = 1,
                    )

                    Text(
                        volumeTitle,
                        fontWeight = FontWeight.Bold,
                        fontSize = 19.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )

                    Text(
                        volumeSubtitle,
                        fontSize = 11.sp,
                        color = muted(),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Spacer(Modifier.width(8.dp))

                StatusChip(acc.status, english)

                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    null,
                    tint = muted(),
                    modifier = Modifier
                        .padding(start = 4.dp)
                        .size(20.dp),
                )
            }

            if (hasLimitedVolume) {
                Spacer(Modifier.height(10.dp))

                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(muted().copy(alpha = 0.18f))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(usedFraction)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(3.dp))
                            .background(
                                if (usedFraction >= 0.9f) Bad else Brand
                            ),
                    )
                }
            }

            if (daysText != null) {
                Spacer(Modifier.height(8.dp))

                Text(
                    daysText,
                    fontSize = 12.sp,
                    color = daysColor,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
fun Banner(text: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.10f), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.35f)),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, null, tint = color)
            Spacer(Modifier.width(10.dp))
            Text(text, color = color, fontSize = 14.sp)
        }
    }
}

// ---------------------------------------------------------------------------------- servers
@Composable
fun ServersScreen(ui: UiState, english: Boolean, onSelect: (Long) -> Unit, connectedId: Long? = null, pingMs: Long? = null) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(if (english) "SERVERS" else "سرورها", fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = if (english) 4.sp else 0.sp)
            Text(
                if (english) "${Format.num(ui.configs.size)} locations available" else "${Format.num(ui.configs.size)} سرور در دسترس",
                color = muted(), fontSize = 13.sp,
            )
            Spacer(Modifier.height(6.dp))
        }
        item {
            ServerRow(
                flag = "⚡",
                title = if (english) "Auto" else "خودکار",
                sub = if (english) "Best server with automatic failover" else "بهترین سرور + جابه‌جایی خودکار در صورت قطعی",
                selected = ui.selectedConfigId < 0,
            ) { onSelect(-1) }
        }
        items(ui.configs, key = { it.id }) { c: VpnConfig ->
            ServerRow(
                flag = flagOf(c.country),
                title = c.name,
                sub = listOf(c.country, c.protocol.uppercase()).filter { it.isNotBlank() }.joinToString(" · "),
                selected = ui.selectedConfigId == c.id,
                connectedLabel = if (connectedId == c.id) (if (english) "Connected" else "متصل") else null,
                pingText = if (connectedId == c.id) pingMs?.let { "${Format.num(it)} ms" } else null,
            ) { onSelect(c.id) }
        }
        if (ui.configs.isEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(84.dp).clip(CircleShape).border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.35f), CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Filled.CloudOff, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(38.dp))
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        ui.blockMessage ?: if (english) "No server available yet" else "فعلاً سروری در دسترس نیست",
                        color = muted(), textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

private fun flagOf(country: String): String {
    val code = country.trim().uppercase()
        .takeIf { it.length == 2 && it.all(Char::isLetter) }
        ?: return "🌐"

    return code.map { char ->
        String(Character.toChars(0x1F1E6 + (char.code - 'A'.code)))
    }.joinToString("")
}

@Composable
fun ServerRow(flag: String, title: String, sub: String, selected: Boolean, connectedLabel: String? = null, pingText: String? = null, onClick: () -> Unit) {
    val context = LocalContext.current
    val primary = MaterialTheme.colorScheme.primary
    val border = if (selected) androidx.compose.foundation.BorderStroke(1.5.dp, primary.copy(alpha = 0.85f)) else glassBorder(0.65f)
    Surface(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable { vibrate(context); onClick() },
        shape = RoundedCornerShape(18.dp), color = if (selected) primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.surface,
        border = border, shadowElevation = 0.dp,
    ) {
        Row(Modifier.padding(horizontal = 15.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(primary.copy(alpha = 0.08f)).border(1.dp, primary.copy(alpha = if (selected) 0.7f else 0.22f), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                if (flag == "🌐") Icon(Icons.Filled.Language, null, tint = primary, modifier = Modifier.size(22.dp)) else Text(flag, fontSize = 21.sp)
            }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (sub.isNotBlank()) Text(sub, color = muted(), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (connectedLabel != null) {
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(7.dp).clip(CircleShape).background(Ok))
                        Spacer(Modifier.width(5.dp))
                        Text(connectedLabel, color = Ok, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                    pingText?.let { Text(it, color = muted(), fontSize = 12.sp) }
                }
                Spacer(Modifier.width(10.dp))
            }
            Icon(if (selected) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = if (selected) primary else muted().copy(alpha = 0.55f), modifier = Modifier.size(21.dp))
        }
    }
}

// ---------------------------------------------------------------------------------- account
@Composable
fun AccountScreen(
    acc: Account?,
    english: Boolean,
    darkMode: Boolean,
    onLanguageChange: (Boolean) -> Unit,
    onDarkModeChange: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    supportTelegram: String = "@Xnetservice2",
    password: String? = null,
) {
    var confirm by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LazyColumn(
        Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                        MaterialTheme.colorScheme.secondary.copy(alpha = 0.035f),
                        MaterialTheme.colorScheme.background,
                    ),
                ),
            ),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(Modifier.fillMaxWidth().padding(bottom = 2.dp)) {
                Text(if (english) "ACCOUNT" else "حساب کاربری", color = MaterialTheme.colorScheme.onSurface, fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = if (english) 4.sp else 0.sp)
                Text(if (english) "Your XNET profile" else "پروفایل XNET شما", color = muted(), fontSize = 12.sp)
            }
        }
        if (acc != null) {
            item { AccountHero(acc, english) }
            item { AccountSectionTitle(if (english) "Subscription" else "اشتراک", english) }
            item { SubscriptionPanel(acc, password, english) }
        } else {
            item {
                Text(
                    if (english) "Account" else "حساب کاربری",
                    fontSize = 26.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
            }
        }

        item {
            AccountSectionTitle(if (english) "Preferences" else "تنظیمات", english)
            AccountSettingsCard {
                SettingRow(icon = if (darkMode) Icons.Filled.DarkMode else Icons.Filled.LightMode, title = if (english) "Dark mode" else "حالت تاریک", subtitle = if (english) "Premium dark interface" else "ظاهر تیره و حرفه‌ای") {
                    Switch(
                        checked = darkMode, onCheckedChange = { vibrate(context); onDarkModeChange(it) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = MaterialTheme.colorScheme.onPrimary, checkedTrackColor = MaterialTheme.colorScheme.primary,
                            uncheckedThumbColor = muted(), uncheckedTrackColor = MaterialTheme.colorScheme.surfaceVariant, uncheckedBorderColor = MaterialTheme.colorScheme.outline,
                        ),
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingRow(icon = Icons.Filled.Translate, title = if (english) "Language" else "زبان", subtitle = if (english) "App language and direction" else "زبان و جهت نمایش برنامه") {
                    Segmented(
                        options = listOf("فارسی", "English"),
                        selected = if (english) 1 else 0,
                        onSelect = { i -> vibrate(context); onLanguageChange(i == 1) },
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingRow(icon = Icons.Filled.Code, title = if (english) "Developer" else "توسعه‌دهنده") {
                    Text(DEVELOPER_NAME, fontWeight = FontWeight.Bold)
                }
            }
        }

        item {
            AccountSectionTitle(if (english) "Support" else "پشتیبانی", english)
            SupportCard(english, supportTelegram)
        }

        item {
            AccountSectionTitle(if (english) "Account actions" else "مدیریت حساب", english)
            AccountSettingsCard {
                AccountActionRow(
                    icon = Icons.Filled.Refresh,
                    title = if (english) "Refresh account" else "به‌روزرسانی حساب",
                    subtitle = if (english) "Sync your latest account details" else "دریافت آخرین اطلاعات حساب",
                    tint = MaterialTheme.colorScheme.primary,
                    onClick = { vibrate(context); onRefresh() },
                )
                HorizontalDivider(
                    Modifier.padding(start = 54.dp),
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.75f),
                )
                AccountActionRow(
                    icon = Icons.AutoMirrored.Filled.Logout,
                    title = if (english) "Sign out" else "خروج از حساب",
                    subtitle = if (english) "Remove this account from this device" else "خروج امن از این دستگاه",
                    tint = Bad,
                    onClick = { vibrate(context); confirm = true },
                )
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            modifier = Modifier.border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.3f), RoundedCornerShape(24.dp)),
            icon = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = Bad) },
            title = { Text(if (english) "Sign out?" else "خروج از حساب؟") },
            text = {
                Text(
                    if (english) "The VPN will disconnect and your login will be removed from this device."
                    else "اتصال قطع و اطلاعات ورود از این دستگاه پاک می‌شود.",
                )
            },
            confirmButton = {
                TextButton(onClick = { confirm = false; vibrate(context); onLogout() }) {
                    Text(if (english) "Sign out" else "خروج", color = Bad, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirm = false; vibrate(context) }) { Text(if (english) "Cancel" else "انصراف") }
            },
            containerColor = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(24.dp),
        )
    }
}

@Composable
private fun AccountHero(acc: Account, english: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = glassBorder(),
        shadowElevation = 0.dp,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(
                    Brush.horizontalGradient(
                        listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.16f),
                            BrandDeep.copy(alpha = 0.08f),
                        ),
                    ),
                )
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(58.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
                    .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.55f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    acc.username.take(1).uppercase(),
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 25.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    if (english) "Your account" else "حساب کاربری شما",
                    color = muted(),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    acc.username,
                    fontSize = 21.sp,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(statusText(acc.status, english), color = statusColor(acc.status), fontSize = 13.sp)
            }
            StatusChip(acc.status, english)
        }
    }
}

@Composable
private fun AccountSectionTitle(title: String, english: Boolean) {
    Text(
        if (english) title.uppercase() else title,
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
        color = muted(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = if (english) 0.8.sp else 0.sp,
    )
}

@Composable
private fun AccountSettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = glassBorder(),
        shadowElevation = 0.dp,
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), content = content)
    }
}

@Composable
private fun AccountActionRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    tint: Color,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 66.dp)
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(tint.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, color = tint)
            Text(subtitle, fontSize = 12.sp, color = muted(), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = muted())
    }
}

@Composable
private fun SupportCard(english: Boolean, supportTelegram: String) {
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                val username = supportTelegram.trim().removePrefix("@")
                if (username.isNotBlank()) uriHandler.openUri("https://t.me/$username")
            },
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = glassBorder(),
        shadowElevation = 0.dp,
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.13f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Send, null, tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    if (english) "Contact support" else "ارتباط با پشتیبانی",
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    supportTelegram.trim().ifBlank { "@Xnetservice2" },
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = muted())
        }
    }
}

private fun statusText(status: String, english: Boolean): String = when (status) {
    "ACTIVE" -> if (english) "Subscription active" else "اشتراک فعال"
    "EXPIRED" -> if (english) "Subscription expired" else "اشتراک منقضی شده"
    "QUOTA_EXCEEDED" -> if (english) "Data limit reached" else "حجم تمام شده"
    "BLOCKED" -> if (english) "Account blocked" else "حساب مسدود است"
    else -> status
}

@Composable
private fun SettingRow(icon: ImageVector, title: String, subtitle: String? = null, trailing: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).padding(end = 8.dp)) {
            Text(title, fontWeight = FontWeight.Medium)
            if (subtitle != null) Text(subtitle, color = muted(), fontSize = 12.sp, lineHeight = 15.sp)
        }
        trailing()
    }
}

@Composable
private fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, height: Dp = 36.dp) {
    Row(
        Modifier
            .height(height)
            .clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(3.dp),
    ) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(50))
                    .background(if (on) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .clickable { if (!on) onSelect(i) }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (on) MaterialTheme.colorScheme.onPrimary else muted())
            }
        }
    }
}
