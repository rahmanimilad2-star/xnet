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
internal val XnetSurface = Color(0xFF08111F)
internal val XnetSurfaceSecondary = Color(0xFF0A1424)
internal val XnetPrimaryText = Color(0xFFEAF3FF)
internal val XnetMutedText = Color(0xFF8FA3C7)
internal val XnetCardShape = RoundedCornerShape(20.dp)

// ------------------------------------------------------------------------------------ schemes
private val XnetDark = darkColorScheme(
    primary = Color(0xFF1FA8FF),
    onPrimary = Color(0xFF02101C),
    secondary = BrandDeep,
    background = Color(0xFF02050C),
    onBackground = Color(0xFFEAF3FF),
    surface = Color(0xFF08111F),
    onSurface = Color(0xFFEAF3FF),
    surfaceVariant = Color(0xFF0A1424),
    onSurfaceVariant = Color(0xFF8FA3C7),
    outline = Color(0xFF18365A),
    outlineVariant = Color(0xFF122A47),
    surfaceContainerLowest = Color(0xFF02050C),
    surfaceContainerLow = Color(0xFF06101D),
    surfaceContainer = Color(0xFF08111F),
    surfaceContainerHigh = Color(0xFF0A1424),
    surfaceContainerHighest = Color(0xFF0D192C),
    surfaceTint = Color(0xFF1FA8FF),
    inverseSurface = Color(0xFF0D192C),
    inverseOnSurface = Color(0xFFEAF3FF),
    error = Bad,
)

private val XnetLight = lightColorScheme(
    primary = Color(0xFF0A84E0),
    onPrimary = Color.White,
    secondary = BrandDeep,
    background = Color(0xFFEDF3FB),
    onBackground = Color(0xFF0B1426),
    surface = Color(0xFFF8FBFF),
    onSurface = Color(0xFF0B1426),
    surfaceVariant = Color(0xFFE2EAF6),
    onSurfaceVariant = Color(0xFF5A6788),
    outline = Color(0xFFCBD6E8),
    outlineVariant = Color(0xFFDCE4F1),
    surfaceContainer = Color(0xFFF1F6FD),
    surfaceContainerHigh = Color(0xFFE9F0FA),
    error = Bad,
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
internal fun muted() = MaterialTheme.colorScheme.onSurfaceVariant

/** Theme-aware structural colors. Never reuse the dark palette in Light mode. */
@Composable
internal fun xnetBorder() = MaterialTheme.colorScheme.outline

@Composable
internal fun xnetGrid() = MaterialTheme.colorScheme.outlineVariant

@Composable
internal fun isDarkTheme() = MaterialTheme.colorScheme.background.luminance() < 0.5f

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
