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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
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

private const val DEVELOPER_NAME = "milad"
private const val APP_TITLE = "Xnet"

private val CardShape = RoundedCornerShape(22.dp)

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
            background = LightBg,
            onBackground = Color(0xFF151827),
            surface = Color.White,
            onSurface = Color(0xFF151827),
            surfaceVariant = Color(0xFFEEF0F7),
            onSurfaceVariant = Color(0xFF6B7287),
            outline = Color(0xFFDDE1EC),
            outlineVariant = Color(0xFFE9ECF3),
            surfaceContainer = Color.White,
            surfaceContainerHigh = Color(0xFFF7F8FC),
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
            LoginScreen(loading = ui.loading, error = ui.loginError, english = english, onLogin = vm::login)
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
    LaunchedEffect(vpn.error) { vpn.error?.let { snack.showSnackbar(it) } }
    LaunchedEffect(vpn.stopCode) { if (vpn.stopCode != null) vm.refreshNow() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                val labels = if (english) listOf("Home", "Servers", "Account") else listOf("خانه", "سرورها", "حساب")
                val icons = listOf(Icons.Filled.Home, Icons.Filled.Public, Icons.Filled.Person)
                labels.forEachIndexed { index, label ->
                    NavigationBarItem(
                        selected = tab == index,
                        onClick = { if (tab != index) { vibrate(context); tab = index } },
                        icon = { Icon(icons[index], null) },
                        label = { Text(label, fontWeight = if (tab == index) FontWeight.Bold else FontWeight.Normal) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                        ),
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                0 -> HomeScreen(ui, vpn, english, onOpenServers = { tab = 1 }) { vm.toggle(onStartVpn) }
                1 -> ServersScreen(ui, english, vm::selectConfig, connectedId = if (vpn.phase == Phase.CONNECTED) vpn.configId else null)
                else -> AccountScreen(
                    acc = ui.account, english = english, darkMode = darkMode,
                    onLanguageChange = onLanguageChange, onDarkModeChange = onDarkModeChange,
                    onRefresh = vm::refreshNow, onLogout = vm::logout,
                )
            }
        }
    }
}

// ------------------------------------------------------------------------------------- home
private data class PhaseLook(val label: String, val color: Color, val deep: Color)

private fun phaseLook(phase: Phase, english: Boolean): PhaseLook = when (phase) {
    Phase.CONNECTED -> PhaseLook(if (english) "Connected" else "متصل", Ok, OkDeep)
    Phase.CONNECTING -> PhaseLook(if (english) "Connecting…" else "در حال اتصال…", Warn, Color(0xFFEA580C))
    Phase.RECONNECTING -> PhaseLook(if (english) "Reconnecting…" else "در حال اتصال مجدد…", Warn, Color(0xFFEA580C))
    Phase.DISCONNECTED -> PhaseLook(if (english) "Disconnected" else "قطع", Brand, BrandDeep)
}

@Composable
fun HomeScreen(ui: UiState, vpn: VpnStatus, english: Boolean, onOpenServers: () -> Unit, onToggle: () -> Unit) {
    val look = phaseLook(vpn.phase, english)
    val color by animateColorAsState(look.color, tween(500), label = "phase")
    val serverName = if (ui.selectedConfigId < 0) {
        if (english) "Auto" else "خودکار"
    } else ui.configs.firstOrNull { it.id == ui.selectedConfigId }?.name ?: autoLabel(ui, english)
    val country = ui.configs.firstOrNull { it.id == vpn.configId }?.country
        ?: ui.configs.firstOrNull { it.id == ui.selectedConfigId }?.country

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // header
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(APP_TITLE, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
                ui.account?.let { Text(if (english) "Hi, ${it.username}" else "سلام ${it.username}", color = muted(), fontSize = 13.sp) }
            }
            StatusPill(look.label, color, pulsing = vpn.phase == Phase.CONNECTING || vpn.phase == Phase.RECONNECTING)
        }

        ui.blockMessage?.let { Banner(it, Bad) }

        Spacer(Modifier.height(4.dp))
        ConnectButton(vpn.phase, look, onToggle)

        Text(look.label, color = color, fontSize = 24.sp, fontWeight = FontWeight.Bold)

        // server chip -> servers tab
        val chipCtx = LocalContext.current
        Surface(
            shape = RoundedCornerShape(50),
            color = MaterialTheme.colorScheme.surface,
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.clip(RoundedCornerShape(50)).clickable { vibrate(chipCtx); onOpenServers() },
        ) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(flagOf(country), fontSize = 18.sp)
                Spacer(Modifier.width(8.dp))
                Text(serverName, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 220.dp))
                Spacer(Modifier.width(6.dp))
                Icon(Icons.Filled.ExpandMore, null, tint = muted(), modifier = Modifier.size(18.dp))
            }
        }

        AnimatedVisibility(visible = vpn.phase == Phase.CONNECTED, enter = fadeIn(), exit = fadeOut()) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    var tick by remember { mutableIntStateOf(0) }
                    LaunchedEffect(Unit) { while (true) { delay(1000); tick++ } }
                    key(tick) {
                        StatCard(if (english) "Session" else "مدت اتصال", Format.duration(vpn.connectedSince), Icons.Filled.Timer, BrandDeep, Modifier.weight(1f))
                    }
                    StatCard(if (english) "Ping" else "پینگ", vpn.pingMs?.let { "${Format.num(it)} ms" } ?: "—", Icons.Filled.Speed, Warn, Modifier.weight(1f))
                }
            }
        }

        ui.account?.let { UsageCard(it, english) }
        Spacer(Modifier.height(8.dp))
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

@Composable
fun UsageCard(acc: Account, english: Boolean = false) {
    if (!acc.usageKnown) { UnknownUsageCard(acc, english); return }
    val p = if (!acc.unlimited && acc.quotaBytes > 0) (acc.usedBytes.toFloat() / acc.quotaBytes).coerceIn(0f, 1f) else 0f
    val progress by animateFloatAsState(p, tween(800), label = "usage")
    val barColor = when { p >= 0.9f -> Bad; p >= 0.7f -> Warn; else -> MaterialTheme.colorScheme.primary }
    Card(Modifier.fillMaxWidth(), shape = CardShape, colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.DataUsage, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text(if (english) "Subscription" else "اشتراک", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (!acc.unlimited) Text("${Format.num((p * 100).toInt())}%", color = barColor, fontWeight = FontWeight.Bold)
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text(Format.bytes(acc.usedBytes), fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.width(6.dp))
                Text(
                    "${if (english) "of" else "از"} ${if (acc.unlimited) (if (english) "Unlimited" else "نامحدود") else Format.bytes(acc.quotaBytes)}",
                    color = muted(), fontSize = 14.sp, modifier = Modifier.padding(bottom = 3.dp),
                )
            }
            if (!acc.unlimited) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(10.dp)),
                    color = barColor,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    strokeCap = StrokeCap.Round,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                InfoTile(if (english) "Remaining" else "باقی‌مانده", if (acc.unlimited) "∞" else Format.bytes(acc.remainingBytes), Modifier.weight(1f))
                InfoTile(
                    if (english) "Days left" else "روز باقی‌مانده",
                    acc.daysLeft?.let { Format.num(it) } ?: "∞",
                    Modifier.weight(1f),
                    valueColor = if ((acc.daysLeft ?: 99) <= 3) Bad else Color.Unspecified,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Event, null, tint = muted(), modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("${if (english) "Expires" else "انقضا"}: ${Format.date(acc.expiresAt)}", color = muted(), fontSize = 13.sp)
            }
            acc.usageSyncedAt?.let {
                Text("${if (english) "Updated" else "به‌روزرسانی آمار"}: ${Format.date(it)}", fontSize = 11.sp, color = muted())
            }
        }
    }
}

/** Configs without traffic data (manual / subscription): informational only, never blocks Connect. */
@Composable
private fun UnknownUsageCard(acc: Account, english: Boolean) {
    Card(Modifier.fillMaxWidth(), shape = CardShape, colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.DataUsage, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text(if (english) "Subscription" else "اشتراک", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Filled.HelpOutline, null, tint = muted(), modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(8.dp))
                Text(if (english) "Data usage unknown" else "حجم نامشخص", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            }
            Text(
                if (english) "Usage isn't tracked for this server. You can connect normally." else "مصرف این سرور ثبت نمی‌شود. اتصال به‌طور کامل فعال است.",
                color = muted(), fontSize = 13.sp,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                InfoTile(
                    if (english) "Days left" else "روز باقی‌مانده",
                    acc.daysLeft?.let { Format.num(it) } ?: "∞",
                    Modifier.weight(1f),
                    valueColor = if ((acc.daysLeft ?: 99) <= 3) Bad else Color.Unspecified,
                )
                InfoTile(if (english) "Expires" else "انقضا", Format.date(acc.expiresAt), Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun InfoTile(title: String, value: String, modifier: Modifier, valueColor: Color = Color.Unspecified) {
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(12.dp),
    ) {
        Text(title, fontSize = 12.sp, color = muted())
        Text(value, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = valueColor)
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
) {
    var confirm by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text(if (english) "Account" else "حساب کاربری", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold) }

        if (acc != null) {
            item {
                // profile header
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(CardShape)
                        .background(Brush.linearGradient(listOf(Brand, BrandDeep)))
                        .padding(18.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(56.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.22f)), contentAlignment = Alignment.Center) {
                            Text(acc.username.take(1).uppercase(), color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(acc.username, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Text(statusText(acc.status, english), color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp)
                        }
                        Surface(color = Color.White.copy(alpha = 0.2f), shape = RoundedCornerShape(50)) {
                            Text(
                                if (acc.isActive) (if (english) "Active" else "فعال") else "!",
                                color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                            )
                        }
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val unknown = if (english) "Unknown" else "نامشخص"
                    StatCard(if (english) "Downloaded" else "دانلود", if (acc.usageKnown) Format.bytes(acc.downloadBytes) else unknown, Icons.Filled.ArrowDownward, Ok, Modifier.weight(1f))
                    StatCard(if (english) "Uploaded" else "آپلود", if (acc.usageKnown) Format.bytes(acc.uploadBytes) else unknown, Icons.Filled.ArrowUpward, Brand, Modifier.weight(1f))
                }
            }
            item { UsageCard(acc, english) }
        }

        item {
            SettingsCard {
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
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(DEVELOPER_NAME, fontWeight = FontWeight.Bold)
                        val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
                        Text("@rahmani208", color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clickable { uriHandler.openUri("https://t.me/rahmani208") })
                    }
                }
            }
        }

        item {
            OutlinedButton(
                onClick = { vibrate(context); onRefresh() },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(16.dp),
            ) {
                Icon(Icons.Filled.Refresh, null)
                Spacer(Modifier.width(8.dp))
                Text(if (english) "Refresh" else "به‌روزرسانی اطلاعات")
            }
        }
        item {
            Button(
                onClick = { vibrate(context); confirm = true },
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Bad.copy(alpha = 0.12f), contentColor = Bad),
                elevation = null,
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null)
                Spacer(Modifier.width(8.dp))
                Text(if (english) "Sign out" else "خروج از حساب", fontWeight = FontWeight.Bold)
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

private fun statusText(status: String, english: Boolean): String = when (status) {
    "ACTIVE" -> if (english) "Subscription active" else "اشتراک فعال"
    "EXPIRED" -> if (english) "Subscription expired" else "اشتراک منقضی شده"
    "QUOTA_EXCEEDED" -> if (english) "Data limit reached" else "حجم تمام شده"
    "BLOCKED" -> if (english) "Account blocked" else "حساب مسدود است"
    else -> status
}

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth(), shape = CardShape, colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), content = content)
    }
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
