package com.milad.vpn.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * Encrypted on-device storage (AES-256, key in Android Keystore).
 * Stores the session token and (for the in-app Subscription Details view) the user's own login
 * password, both encrypted with AES-256 (Android Keystore); wiped on sign-out. Configs are cached encrypted so a
 * reconnect works even if the backend is briefly unreachable.
 */
class SessionStore(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "secure_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()

    var username: String?
        get() = prefs.getString("username", null)
        set(v) = prefs.edit().putString("username", v).apply()

    /** Login password, encrypted at rest; shown only on demand in Account (hidden by default). */
    var password: String?
        get() = prefs.getString("password", null)
        set(v) = prefs.edit().putString("password", v).apply()

    /** -1 = Auto (lowest real latency + failover); otherwise that location only */
    var selectedConfigId: Long
        get() = prefs.getLong("selected_config", -1L)
        set(v) = prefs.edit().putLong("selected_config", v).apply()

    fun saveConfigs(b: ConfigBundle) {
        val arr = JSONArray().apply { b.configs.forEach { put(it.toJson()) } }
        prefs.edit().putString("configs", JSONObject().put("version", b.version).put("sync", b.syncAfterSeconds).put("list", arr).toString()).apply()
    }

    fun loadConfigs(): ConfigBundle? = prefs.getString("configs", null)?.let {
        runCatching {
            val j = JSONObject(it)
            val arr = j.getJSONArray("list")
            ConfigBundle((0 until arr.length()).map { i -> VpnConfig.from(arr.getJSONObject(i)) }, j.optString("version"), j.optInt("sync", 300))
        }.getOrNull()
    }

    /** Token of a sign-out that couldn't reach the server yet (offline); retried later. */
    var pendingRelease: String?
        get() = prefs.getString("pending_release", null)
        set(v) = prefs.edit().putString("pending_release", v).apply()

    fun clear() = prefs.edit().clear().apply()
}
