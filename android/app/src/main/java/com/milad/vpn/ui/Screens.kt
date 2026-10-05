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
import com.milad.vpn.data.Account
import com.milad.vpn.data.VpnConfig
import com.milad.vpn.vpn.Phase
import com.milad.vpn.vpn.VpnStatus
import kotlinx.coroutines.delay

// ------------------------------------------------------------------------------------ tokens
private val Brand = Color(0xFF4F5BFF)
private val BrandDeep = Color(0xFF7B4DFF)
private val Ok = Color(0xFF12B76A)
private val OkDeep = Color(0xFF0E9F6E)
private val Warn = Color(0xFFF59E0B)
private val Bad = Color(0xFFEF4444)

private val LightBg = Color(0xFFF4F6FB)
private val DarkBg = Color(0xFF0B0D12)
private val DarkSurface = Color(0xFF151821)
private val DarkSurface2 = Color(0xFF1D212D)

private const val DEVELOPER_NAME = "M.R"
private const val SUPPORT_TELEGRAM = "@rahmani208"
private const val APP_TITLE = "Xnet"

private val CardShape = RoundedCornerShape(20.dp)

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

// ------------------------------------------------------------------------------------ theme
@Composable
fun AppTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    val colors = if (darkTheme) {
        darkColorScheme(
            primary = Color(0xFF7C86FF),
            onPrimary = Color.White,
            secondary = BrandDeep,
            background = DarkBg,
            onBackground = Color(0xFFE8EAF2),
            surface = DarkSurface,
            onSurface = Color(0xFFE8EAF2),
            surfaceVariant = DarkSurface2,
            onSurfaceVariant = Color(0xFF9AA1B5),
            outline = Color(0xFF2A2F3D),
            outlineVariant = Color(0xFF232733),
            surfaceContainer = DarkSurface,
            surfaceContainerHigh = DarkSurface2,
        )
    } else {
        lightColorScheme(
            primary = Brand,
            onPrimary = Color.White,
            secondary = BrandDeep,
            background = Color(0xFFEEF1F8),
            onBackground = Color(0xFF151827),
            surface = Color(0xFFF9FAFD),
            onSurface = Color(0xFF151827),
            surfaceVariant = Color(0xFFE6EAF3),
            onSurfaceVariant = Color(0xFF6B7287),
            outline = Color(0xFFDDE1EC),
            outlineVariant = Color(0xFFE9ECF3),
            surfaceContainer = Color(0xFFF5F7FB),
            surfaceContainerHigh = Color(0xFFEFF2F8),
        )
    }
    MaterialTheme(colorScheme = colors) {
        // Paint the whole window so dark mode covers every pixel (behind status/navigation bars too).
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, content = content)
    }
}

@Composable
private fun muted() = MaterialTheme.colorScheme.onSurfaceVariant

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
        // gradient hero behind the card
        Box(
            Modifier
                .fillMaxWidth()
                .height(320.dp)
                .background(Brush.linearGradient(listOf(Brand, BrandDeep)))
        )
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
                    .background(Color.White.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Shield, null, tint = Color.White, modifier = Modifier.size(42.dp)) }
            Spacer(Modifier.height(14.dp))
            Text(APP_TITLE, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
            Text(
                if (english) "Fast · Private · Secure" else "سریع · خصوصی · امن",
                color = Color.White.copy(alpha = 0.85f), fontSize = 14.sp,
            )
            Spacer(Modifier.height(30.dp))

            Card(
                shape = RoundedCornerShape(26.dp),
                colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
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
                        singleLine = true, shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                    )
                    OutlinedTextField(
                        value = pass, onValueChange = { pass = it },
                        label = { Text(if (english) "Password" else "رمز عبور") },
                        leadingIcon = { Icon(Icons.Filled.Lock, null) },
                        singleLine = true, shape = RoundedCornerShape(14.dp),
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
            .background(Brush.horizontalGradient(listOf(Brand, BrandDeep)))
            .clickable(enabled = !loading, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
        else Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
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
        snackbarHost = { SnackbarHost(snack) },
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
            when (tab) {
                0 -> HomeScreen(ui, vpn, english, onOpenServers = { tab = 1 }, onOpenAccount = { tab = 2 }) { vm.toggle(onStartVpn) }
                1 -> ServersScreen(ui, english, vm::selectConfig, connectedId = if (vpn.phase == Phase.CONNECTED) vpn.configId else null)
                else -> AccountScreen(
                    acc = ui.account, english = english, darkMode = darkMode,
                    password = remember(ui.account?.username) { com.milad.vpn.data.Repository.session.password },
                    onLanguageChange = onLanguageChange, onDarkModeChange = onDarkModeChange,
                    onRefresh = vm::refreshNow, onLogout = vm::logout,
                )
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
    Phase.CONNECTED -> PhaseLook(if (english) "Connected" else "متصل", Ok, OkDeep)
    Phase.CONNECTING -> PhaseLook(if (english) "Connecting…" else "در حال اتصال…", Warn, Color(0xFFEA580C))
    Phase.RECONNECTING -> PhaseLook(if (english) "Reconnecting…" else "در حال اتصال مجدد…", Warn, Color(0xFFEA580C))
    Phase.DISCONNECTED -> PhaseLook(if (english) "Disconnected" else "قطع", Brand, BrandDeep)
}

@Composable
fun HomeScreen(ui: UiState, vpn: VpnStatus, english: Boolean, onOpenServers: () -> Unit, onOpenAccount: () -> Unit = {}, onToggle: () -> Unit) {
    val look = phaseLook(vpn, english)
    val color by animateColorAsState(look.color, tween(500), label = "phase")
    val auto = ui.selectedConfigId < 0
    val selectedCfg = ui.configs.firstOrNull { it.id == ui.selectedConfigId }
    val connectedCfg = if (vpn.phase == Phase.CONNECTED) ui.configs.firstOrNull { it.id == vpn.configId } else null
    val shownCfg = selectedCfg ?: connectedCfg
    val serverName = shownCfg?.name ?: if (auto) (if (english) "Auto" else "خودکار") else autoLabel(ui, english)
    val serverSub = when {
        auto && shownCfg != null -> listOf(if (english) "Auto" else "خودکار", shownCfg.protocol.uppercase()).filter { it.isNotBlank() }.joinToString(" · ")
        auto -> if (english) "Best server, automatic failover" else "بهترین سرور + جابه‌جایی خودکار"
        else -> listOf(shownCfg?.country.orEmpty(), shownCfg?.protocol?.uppercase().orEmpty()).filter { it.isNotBlank() }.joinToString(" · ")
    }
    val country = ui.configs.firstOrNull { it.id == vpn.configId }?.country ?: selectedCfg?.country
    val hint = when (vpn.phase) {
        Phase.DISCONNECTED -> if (vpn.isQuotaExceeded || ui.blockCode == "QUOTA_EXCEEDED") (if (english) VpnStatus.QUOTA_MESSAGE_EN else VpnStatus.QUOTA_MESSAGE_FA)
            else if (vpn.isError) (if (english) "Tap to try again" else "برای تلاش دوباره، دکمه را لمس کنید")
            else if (english) "Tap to connect securely" else "برای اتصال امن، دکمه را لمس کنید"
        // real step from the connection owner (refreshing / measuring ping / connecting to X / waiting for internet)
        Phase.CONNECTING, Phase.RECONNECTING -> vpn.detail?.takeIf { !english }
            ?: if (english) "Establishing secure tunnel…" else "در حال برقراری تونل امن…"
        Phase.CONNECTED -> if (english) "Your connection is secured" else "اتصال شما امن است"
    }

    // xnet-ui-polish-v1: background reaches behind the status bar; content stays inside safe area.
    val glow by animateColorAsState(look.color.copy(alpha = 0.20f), tween(700), label = "bgGlow")
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(glow, Color.Transparent), endY = 1400f))
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top)),
        contentAlignment = Alignment.TopCenter,
    ) {
        val viewport = maxHeight
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            // Fills at least the screen: header top, connect button centred, details anchored at the bottom.
            Column(
                Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth()
                    .heightIn(min = viewport)
                    .padding(horizontal = 18.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    Modifier.size(34.dp).clip(RoundedCornerShape(11.dp))
                                        .background(Brush.linearGradient(listOf(Brand, BrandDeep))),
                                    contentAlignment = Alignment.Center,
                                ) { Icon(Icons.Filled.Shield, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
                                Spacer(Modifier.width(10.dp))
                                Text(APP_TITLE, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                            }
                            ui.account?.let { Text(if (english) "Hi, ${it.username}" else "سلام ${it.username}", color = muted(), fontSize = 13.sp) }
                        }
                        StatusPill(look.label, color, pulsing = vpn.phase == Phase.CONNECTING || vpn.phase == Phase.RECONNECTING)
                    }
                    ui.blockMessage?.let { Banner(if (ui.blockCode == "QUOTA_EXCEEDED") (if (english) VpnStatus.QUOTA_MESSAGE_EN else VpnStatus.QUOTA_MESSAGE_FA) else it, Bad) }
                }

                Column(Modifier.padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    ConnectButton(vpn.phase, look, onToggle)
                    Spacer(Modifier.height(18.dp))
                    Text(look.label, color = color, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(hint, color = muted(), fontSize = 13.sp, textAlign = TextAlign.Center)
                }

                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ServerCard(flagOf(country), serverName, serverSub, color, english, onOpenServers)
                    AnimatedVisibility(visible = vpn.phase == Phase.CONNECTED, enter = fadeIn(), exit = fadeOut()) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            var tick by remember { mutableIntStateOf(0) }
                            LaunchedEffect(Unit) { while (true) { delay(1000); tick++ } }
                            key(tick) {
                                StatCard(if (english) "Session" else "مدت اتصال", Format.duration(vpn.connectedSince), Icons.Filled.Timer, BrandDeep, Modifier.weight(1f))
                            }
                            StatCard(if (english) "Ping" else "پینگ", vpn.pingMs?.let { "${Format.num(it)} ms" } ?: "—", Icons.Filled.Speed, Warn, Modifier.weight(1f))
                        }
                    }
                    ui.account?.let { SubscriptionStrip(it, english, onOpenAccount) }
                }
            }
        }
    }
}

/** Current server (real config data). Tap -> Servers tab. */
@Composable
private fun ServerCard(flag: String, title: String, sub: String, accent: Color, english: Boolean, onClick: () -> Unit) {
    val context = LocalContext.current
    Surface(
        shape = CardShape,
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = 0.35f)),
        modifier = Modifier.fillMaxWidth().clip(CardShape).clickable { vibrate(context); onClick() },
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) { Text(flag, fontSize = 22.sp) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(if (english) "Server" else "سرور", fontSize = 12.sp, color = muted())
                Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (sub.isNotBlank()) Text(sub, fontSize = 12.sp, color = muted(), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(8.dp))
            Text(if (english) "Change" else "تغییر", color = MaterialTheme.colorScheme.primary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
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
    Box(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.96f))
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
            .padding(horizontal = 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth(),
            shape = RoundedCornerShape(22.dp),
            color = MaterialTheme.colorScheme.surfaceContainer,
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.85f)),
            shadowElevation = 10.dp,
        ) {
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
                                .background(pill),
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

private fun autoLabel(ui: UiState, english: Boolean): String =
    ui.configs.firstOrNull { it.id == ui.selectedConfigId }?.name
        ?: if (english) "Auto · best server" else "خودکار · بهترین سرور"

private fun flagOf(country: String?): String {
    val cc = country?.trim()?.uppercase().orEmpty()
    if (cc.length != 2 || !cc.all { it in 'A'..'Z' }) return "🌐"
    return cc.map { String(Character.toChars(0x1F1E6 + (it - 'A'))) }.joinToString("")
}

@Composable
private fun StatusPill(text: String, color: Color, pulsing: Boolean) {
    val t = rememberInfiniteTransition(label = "pill")
    val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "dot")
    Surface(color = color.copy(alpha = 0.14f), shape = RoundedCornerShape(50)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(color.copy(alpha = if (pulsing) a else 1f)))
            Spacer(Modifier.width(6.dp))
            Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ConnectButton(phase: Phase, look: PhaseLook, onClick: () -> Unit) {
    val context = LocalContext.current
    val c1 by animateColorAsState(look.color, tween(500), label = "c1")
    val c2 by animateColorAsState(look.deep, tween(500), label = "c2")
    val busy = phase == Phase.CONNECTING || phase == Phase.RECONNECTING
    val t = rememberInfiniteTransition(label = "rings")
    val ring by t.animateFloat(0f, 1f, infiniteRepeatable(tween(2200, easing = LinearEasing)), label = "ring")
    val spin by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1100, easing = LinearEasing)), label = "spin")
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (pressed) 0.94f else 1f, tween(120, easing = FastOutSlowInEasing), label = "press")
    LaunchedEffect(pressed) { if (pressed) { delay(140); pressed = false } }

    Box(Modifier.size(250.dp), contentAlignment = Alignment.Center) {
        // ambient rings: expanding while connected/connecting
        Canvas(Modifier.fillMaxSize()) {
            val r0 = size.minDimension / 2f * 0.62f
            if (phase != Phase.DISCONNECTED) {
                for (i in 0..1) {
                    val p = (ring + i * 0.5f) % 1f
                    drawCircle(c1.copy(alpha = (1f - p) * 0.28f), radius = r0 + (size.minDimension / 2f - r0) * p)
                }
            } else {
                drawCircle(c1.copy(alpha = 0.10f), radius = size.minDimension / 2f * 0.86f)
            }
            drawCircle(c1.copy(alpha = 0.16f), radius = size.minDimension / 2f * 0.74f)
            if (busy) {
                drawArc(
                    color = Color.White.copy(alpha = 0.9f), startAngle = spin, sweepAngle = 80f, useCenter = false,
                    topLeft = Offset(size.width / 2f - r0 + 6f, size.height / 2f - r0 + 6f),
                    size = androidx.compose.ui.geometry.Size((r0 - 6f) * 2f, (r0 - 6f) * 2f),
                    style = Stroke(width = 8f, cap = StrokeCap.Round),
                )
            }
        }
        Box(
            Modifier
                .size(156.dp)
                .scale(scale)
                .clip(CircleShape)
                .background(Brush.linearGradient(listOf(c1, c2)))
                .border(4.dp, Color.White.copy(alpha = 0.25f), CircleShape)
                .clickable {
                    pressed = true
                    vibrate(context, strong = true)
                    onClick()
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.PowerSettingsNew,
                contentDescription = if (phase == Phase.DISCONNECTED) "Connect" else "Disconnect",
                tint = Color.White, modifier = Modifier.size(68.dp),
            )
        }
    }
}

@Composable
private fun StatCard(title: String, value: String, icon: ImageVector, tint: Color, modifier: Modifier) {
    Card(modifier, shape = CardShape, colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surface)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column {
                Text(title, fontSize = 12.sp, color = muted())
                Text(value, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1)
            }
        }
    }
}

// ------------------------------------------------------------ subscription (xnet-subscription-v1)
// All values come from the signed-in user's /account response; the password is the one this
// device logged in with (encrypted in SessionStore). Nothing here is hard-coded.
private fun planLabel(acc: Account, english: Boolean): String =
    if (acc.unlimited || acc.quotaBytes <= 0) (if (english) "Unlimited" else "نامحدود")
    else "${Format.bytes(acc.quotaBytes)} · ${if (english) "Data plan" else "حجمی"}"

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
        acc.expiresAt < System.currentTimeMillis() -> if (english) " · expired" else " · منقضی شده"
        d <= 0 -> if (english) " · ends today" else " · امروز تمام می‌شود"
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
    Card(
        Modifier.fillMaxWidth(),
        shape = CardShape,
        colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surfaceContainerHigh),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.9f),
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
    ) {
        // header: identity + status
        Row(
            Modifier.fillMaxWidth()
                .background(Brush.linearGradient(listOf(Brand, BrandDeep)))
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.22f)), contentAlignment = Alignment.Center) {
                Text(acc.username.take(1).uppercase(), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(if (english) "Subscription details" else "مشخصات اشتراک", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(statusText(acc.status, english), color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp)
            }
            StatusChip(acc.status, english, onDark = true)
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
fun SubscriptionStrip(acc: Account, english: Boolean, onOpen: () -> Unit) {
    val context = LocalContext.current
    val volume = SubscriptionUsage.volume(acc)
    val time = SubscriptionUsage.time(acc)
    val volumeText = when (volume) {
        SubscriptionUsage.Volume.Unknown -> if (english) "Usage not available" else "حجم نامشخص"
        is SubscriptionUsage.Volume.Unlimited ->
            if (english) "${Format.bytes(volume.usedBytes)} used · Unlimited" else "${Format.bytes(volume.usedBytes)} مصرف شده · نامحدود"
        is SubscriptionUsage.Volume.Limited ->
            if (english) "${Format.bytes(volume.remainingBytes)} left of ${Format.bytes(volume.quotaBytes)}"
            else "${Format.bytes(volume.remainingBytes)} باقی‌مانده از ${Format.bytes(volume.quotaBytes)}"
    }
    val usedText = (volume as? SubscriptionUsage.Volume.Limited)?.let {
        if (english) "${Format.bytes(it.usedBytes)} used" else "${Format.bytes(it.usedBytes)} مصرف شده"
    }
    val timeText = when (time) {
        SubscriptionUsage.Time.NoLimit -> if (english) "No time limit" else "بدون محدودیت زمانی"
        SubscriptionUsage.Time.Expired -> if (english) "Expired" else "منقضی شده"
        is SubscriptionUsage.Time.DaysLeft -> if (english) "⏳ ${time.days} days left" else "⏳ ${Format.num(time.days)} روز باقی‌مانده"
    }
    val timeColor = when (time) {
        SubscriptionUsage.Time.Expired -> Bad
        is SubscriptionUsage.Time.DaysLeft -> if (time.days <= 3) Bad else muted()
        SubscriptionUsage.Time.NoLimit -> muted()
    }
    Card(
        Modifier.fillMaxWidth().clip(CardShape).clickable { vibrate(context); onOpen() },
        shape = CardShape, colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(Brush.linearGradient(listOf(Brand, BrandDeep))),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.WorkspacePremium, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (english) "📊 Subscription usage" else "📊 مصرف اشتراک", fontSize = 12.sp, color = muted(), maxLines = 1)
                    Text(volumeText, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.width(8.dp))
                StatusChip(acc.status, english)
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = muted(),
                    modifier = Modifier.padding(start = 4.dp).size(20.dp),
                )
            }
            if (volume is SubscriptionUsage.Volume.Limited) {
                Spacer(Modifier.height(10.dp))
                Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(muted().copy(alpha = 0.18f))) {
                    Box(
                        Modifier.fillMaxWidth(volume.usedFraction).fillMaxHeight().clip(RoundedCornerShape(3.dp))
                            .background(if (volume.usedFraction >= 0.9f) Bad else Brand),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(timeText, fontSize = 12.sp, color = timeColor, maxLines = 1, modifier = Modifier.weight(1f))
                usedText?.let { Text(it, fontSize = 12.sp, color = muted(), maxLines = 1) }
            }
        }
    }
}

@Composable
fun Banner(text: String, color: Color) {
    Surface(color = color.copy(alpha = 0.12f), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, null, tint = color)
            Spacer(Modifier.width(10.dp))
            Text(text, color = color, fontSize = 14.sp)
        }
    }
}

// ---------------------------------------------------------------------------------- servers
@Composable
fun ServersScreen(ui: UiState, english: Boolean, onSelect: (Long) -> Unit, connectedId: Long? = null) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text(if (english) "Servers" else "سرورها", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
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
            ) { onSelect(c.id) }
        }
        if (ui.configs.isEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.CloudOff, null, tint = muted(), modifier = Modifier.size(48.dp))
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

@Composable
fun ServerRow(flag: String, title: String, sub: String, selected: Boolean, connectedLabel: String? = null, onClick: () -> Unit) {
    val context = LocalContext.current
    val primary = MaterialTheme.colorScheme.primary
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(if (selected) 2.dp else 0.dp, if (selected) primary else Color.Transparent, CardShape)
            .clip(CardShape)
            .clickable { vibrate(context); onClick() },
        shape = CardShape,
        colors = CardDefaults.cardColors(if (selected) primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                Text(flag, fontSize = 22.sp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (sub.isNotBlank()) Text(sub, fontSize = 12.sp, color = muted(), maxLines = 2)
            }
            if (connectedLabel != null) {
                Surface(color = Ok.copy(alpha = 0.14f), shape = RoundedCornerShape(50)) {
                    Text(connectedLabel, color = Ok, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                }
                Spacer(Modifier.width(8.dp))
            }
            Icon(
                if (selected) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null,
                tint = if (selected) primary else muted(),
            )
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
                SettingRow(icon = if (darkMode) Icons.Filled.DarkMode else Icons.Filled.LightMode, title = if (english) "Dark mode" else "حالت تاریک") {
                    Switch(checked = darkMode, onCheckedChange = { vibrate(context); onDarkModeChange(it) })
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingRow(icon = Icons.Filled.Translate, title = if (english) "Language" else "زبان") {
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
            SupportCard(english)
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
        )
    }
}

@Composable
private fun AccountHero(acc: Account, english: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.primary.copy(alpha = 0.20f),
        ),
        shadowElevation = 4.dp,
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
                    .background(Brush.linearGradient(listOf(Brand, BrandDeep))),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    acc.username.take(1).uppercase(),
                    color = Color.White,
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
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.9f),
        ),
        shadowElevation = 3.dp,
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
private fun SupportCard(english: Boolean) {
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { uriHandler.openUri("https://t.me/rahmani208") },
        shape = CardShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.primary.copy(alpha = 0.22f),
        ),
        shadowElevation = 3.dp,
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
                    SUPPORT_TELEGRAM,
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
private fun SettingRow(icon: ImageVector, title: String, trailing: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(title, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
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
                Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (on) Color.White else muted())
            }
        }
    }
}
