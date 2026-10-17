package com.milad.vpn.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape

/*
 * XNET Design System (UI only).
 * One palette + one ColorScheme per mode; screens read colours from MaterialTheme and only use
 * the semantic accents below (Brand / Cyan / Ok / Warn / Bad) for state colours.
 */

// ------------------------------------------------------------------------------------ accents
internal val Brand = Color(0xFF1FA8FF)
internal val BrandDeep = Color(0xFF2F5BFF)
internal val Cyan = Color(0xFF22D3FF)
internal val CyanDeep = Color(0xFF1456FF)
internal val Steel = Color(0xFF8FA3D6)
internal val SteelDeep = Color(0xFF2A3A6B)
internal val Ok = Color(0xFF12B76A)
internal val OkDeep = Color(0xFF0E9F6E)
internal val Warn = Color(0xFFF59E0B)
internal val Bad = Color(0xFFEF4444)

// Shared visual constants used by the redesigned presentation layer.
internal val XnetSurface = Color(0xFF101722)
internal val XnetSurfaceSecondary = Color(0xFF151F2D)
internal val XnetPrimaryText = Color(0xFFEAF1FA)
internal val XnetMutedText = Color(0xFF9AAAC0)
internal val XnetCardShape = RoundedCornerShape(20.dp)

// ------------------------------------------------------------------------------------ schemes
private val XnetDark = darkColorScheme(
    primary = Color(0xFF40B8FF),
    onPrimary = Color(0xFF061321),
    secondary = BrandDeep,
    onSecondary = Color.White,
    tertiary = Cyan,
    onTertiary = Color(0xFF061321),
    background = Color(0xFF080D16),
    onBackground = Color(0xFFEAF1FA),
    surface = Color(0xFF101722),
    onSurface = Color(0xFFEAF1FA),
    surfaceVariant = Color(0xFF151F2D),
    onSurfaceVariant = Color(0xFF9AAAC0),
    outline = Color(0xFF29384B),
    outlineVariant = Color(0xFF1D2939),
    surfaceContainerLowest = Color(0xFF080D16),
    surfaceContainerLow = Color(0xFF0D141F),
    surfaceContainer = Color(0xFF101722),
    surfaceContainerHigh = Color(0xFF151F2D),
    surfaceContainerHighest = Color(0xFF1B2737),
    surfaceTint = Color(0xFF40B8FF),
    inverseSurface = Color(0xFFEAF1FA),
    inverseOnSurface = Color(0xFF101722),
    error = Bad,
)
private val XnetLight = lightColorScheme(
    primary = Color(0xFF168FE3),
    onPrimary = Color.White,
    secondary = Color(0xFF315FE8),
    onSecondary = Color.White,
    tertiary = Color(0xFF008FAE),
    onTertiary = Color.White,
    background = Color(0xFFF2F5FA),
    onBackground = Color(0xFF172438),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF172438),
    surfaceVariant = Color(0xFFEAF0F7),
    onSurfaceVariant = Color(0xFF53657C),
    outline = Color(0xFFCBD5E3),
    outlineVariant = Color(0xFFDDE5EF),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF8FAFD),
    surfaceContainer = Color(0xFFF1F5FA),
    surfaceContainerHigh = Color(0xFFEAF0F7),
    surfaceContainerHighest = Color(0xFFE1E9F3),
    surfaceTint = Color(0xFF168FE3),
    inverseSurface = Color(0xFF101722),
    inverseOnSurface = Color(0xFFEAF1FA),
    error = Bad,
    onError = Color.White,
)
@Composable
fun AppTheme(darkTheme: Boolean = true, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) XnetDark else XnetLight) {
        // Paint the whole window so both modes cover every pixel (behind status/navigation bars too).
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, content = content)
    }
}

/** Dark input containers with a thin blue outline. */
@Composable
internal fun xnetFieldColors() = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
    focusedBorderColor = MaterialTheme.colorScheme.primary,
    unfocusedBorderColor = MaterialTheme.colorScheme.outline,
    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
    cursorColor = MaterialTheme.colorScheme.primary,
    focusedLabelColor = MaterialTheme.colorScheme.primary,
    unfocusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
)

@Composable
internal fun muted(): Color {
    val dark = isDarkTheme()
    return if (dark) {
        MaterialTheme.colorScheme.onSurfaceVariant
    } else {
        Color(0xFF40546B)
    }
}

/** Theme-aware structural colors. Never reuse the dark palette in Light mode. */
@Composable
internal fun xnetBorder() = MaterialTheme.colorScheme.outline

@Composable
internal fun xnetGrid() = MaterialTheme.colorScheme.outlineVariant

@Composable
internal fun isDarkTheme() = MaterialTheme.colorScheme.background.luminance() < 0.5f

/**
 * Solid (fully opaque) surfaces for the Servers screen. Every value is a literal ARGB colour, never a
 * low-alpha overlay, so cards cannot blend into the page background in either theme.
 */
internal class ServerPalette(
    val cardSurface: Color, val cardBorder: Color, val iconTile: Color,
    val selectedSurface: Color, val selectedBorder: Color, val accent: Color,
    val autoSurface: Color, val autoSurfaceSelected: Color, val autoBorder: Color, val autoBorderSelected: Color,
    val autoOnSurface: Color, val autoMuted: Color, val autoChip: Color,
    val okText: Color, val okBorder: Color, val okChip: Color,
    val errSurface: Color, val errBorder: Color, val errText: Color, val errChip: Color,
    val headerStart: Color, val headerEnd: Color, val headerBorder: Color,
)

private val ServerPaletteDark = ServerPalette(
    cardSurface = Color(0xFF111C2B), cardBorder = Color(0xFF23344B), iconTile = Color(0xFF192A40),
    selectedSurface = Color(0xFF0F2438), selectedBorder = Color(0xFF40B8FF), accent = Color(0xFF40B8FF),
    autoSurface = Color(0xFF0E2440), autoSurfaceSelected = Color(0xFF0F2D52),
    autoBorder = Color(0xFF245B8F), autoBorderSelected = Color(0xFF22D3FF),
    autoOnSurface = Color(0xFFEAF1FA), autoMuted = Color(0xFFA9BEDA), autoChip = Color(0xFF0A3558),
    okText = Color(0xFF34D399), okBorder = Color(0xFF1F9D70), okChip = Color(0xFF0E2B24),
    errSurface = Color(0xFF2A1518), errBorder = Color(0xFF8E3A3A), errText = Color(0xFFFFB4B4), errChip = Color(0xFF3A1E22),
    headerStart = Color(0xFF0C2748), headerEnd = Color(0xFF0A1730), headerBorder = Color(0xFF1F4A7A),
)

private val ServerPaletteLight = ServerPalette(
    cardSurface = Color(0xFFFFFFFF), cardBorder = Color(0xFFC3D3E6), iconTile = Color(0xFFE6EEF9),
    selectedSurface = Color(0xFFE4F0FD), selectedBorder = Color(0xFF168FE3), accent = Color(0xFF0B63C8),
    autoSurface = Color(0xFFD6E8FB), autoSurfaceSelected = Color(0xFFC4DDF8),
    autoBorder = Color(0xFF6FA8E6), autoBorderSelected = Color(0xFF1565D8),
    autoOnSurface = Color(0xFF0F2540), autoMuted = Color(0xFF34506F), autoChip = Color(0xFFFFFFFF),
    okText = Color(0xFF047857), okBorder = Color(0xFF12B76A), okChip = Color(0xFFE1F5EC),
    errSurface = Color(0xFFFDECEC), errBorder = Color(0xFFE08A8A), errText = Color(0xFF9B1C1C), errChip = Color(0xFFFAD4D4),
    headerStart = Color(0xFF15427F), headerEnd = Color(0xFF0E2E5C), headerBorder = Color(0xFF2C6AB8),
)

@Composable
internal fun serverPalette(): ServerPalette = if (isDarkTheme()) ServerPaletteDark else ServerPaletteLight

/** Shared card outline: a thin cyan-to-blue gradient line. */
@Composable
internal fun glassBorder(strength: Float = 1f): BorderStroke {
    val c = MaterialTheme.colorScheme.primary
    return BorderStroke(1.dp, Brush.linearGradient(listOf(c.copy(alpha = 0.40f * strength), BrandDeep.copy(alpha = 0.14f * strength))))
}

// ----------------------------------------------------------------------------------- backdrop
/** Soft bokeh dots (fractions of the canvas, so it scales to any screen). Purely decorative, static. */
private val Bokeh = listOf(
    floatArrayOf(0.12f, 0.10f, 0.05f, 0f), floatArrayOf(0.84f, 0.16f, 0.07f, 1f), floatArrayOf(0.30f, 0.30f, 0.035f, 1f),
    floatArrayOf(0.92f, 0.42f, 0.05f, 0f), floatArrayOf(0.06f, 0.58f, 0.06f, 0f), floatArrayOf(0.78f, 0.74f, 0.06f, 1f),
    floatArrayOf(0.20f, 0.86f, 0.05f, 0f), floatArrayOf(0.55f, 0.06f, 0.03f, 1f),
)

@Composable
internal fun HomeBackdrop(accent: Color, strength: Float) {
    val k = if (isDarkTheme()) 1f else 0.3f
    val grid = xnetGrid().copy(alpha = 0.22f * k)
    val primary = MaterialTheme.colorScheme.primary
    val secondary = MaterialTheme.colorScheme.secondary

    Canvas(Modifier.fillMaxSize()) {
        val step = 42.dp.toPx()
        var x = 0f
        while (x <= size.width) {
            drawLine(grid, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
            x += step
        }
        var y = 0f
        while (y <= size.height) {
            drawLine(grid, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
            y += step
        }
        drawRect(
            Brush.radialGradient(
                listOf(accent.copy(alpha = 0.30f * strength * k), Color.Transparent),
                center = Offset(size.width / 2f, size.height * 0.34f), radius = size.width * 0.95f,
            )
        )
        Bokeh.forEach { d ->
            val c = if (d[3] > 0.5f) primary else secondary
            val at = Offset(size.width * d[0], size.height * d[1])
            drawCircle(
                Brush.radialGradient(listOf(c.copy(alpha = (0.16f + 0.10f * strength) * k), Color.Transparent), center = at, radius = size.width * d[2] * 2f),
                radius = size.width * d[2] * 2f, center = at,
            )
        }
    }
}
