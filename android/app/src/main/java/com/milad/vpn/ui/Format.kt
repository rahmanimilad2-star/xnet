package com.milad.vpn.ui

import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Format {
    private val fa = Locale("fa", "IR")
    private val nf: NumberFormat = NumberFormat.getNumberInstance(fa).apply { maximumFractionDigits = 2 }

    fun num(n: Number): String = nf.format(n)

    fun bytes(b: Long?): String {
        if (b == null) return "—"
        val units = listOf("بایت", "KB", "MB", "GB", "TB")
        var v = b.toDouble(); var i = 0
        while (v >= 1024 && i < units.lastIndex) { v /= 1024; i++ }
        return "${nf.format(if (i >= 3) Math.round(v * 100) / 100.0 else Math.round(v).toDouble())} ${units[i]}"
    }

    fun speed(bps: Long): String = "${bytes(bps)}/s"

    /** Shamsi (Persian calendar) date via ICU on API 24+. */
    fun date(ms: Long?): String {
        if (ms == null) return "نامحدود"
        return runCatching {
            val c = android.icu.util.Calendar.getInstance(android.icu.util.ULocale("fa_IR@calendar=persian"))
            c.timeInMillis = ms
            val f = android.icu.text.DateFormat.getDateInstance(android.icu.text.DateFormat.MEDIUM, android.icu.util.ULocale("fa_IR@calendar=persian"))
            f.format(c.time)
        }.getOrElse { SimpleDateFormat("yyyy/MM/dd", fa).format(Date(ms)) }
    }

    fun duration(sinceMs: Long?): String {
        if (sinceMs == null) return "—"
        val s = (System.currentTimeMillis() - sinceMs) / 1000
        return String.format(fa, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }
}
