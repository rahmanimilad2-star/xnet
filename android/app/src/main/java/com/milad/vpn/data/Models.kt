package com.milad.vpn.data

import org.json.JSONObject

data class SubscriptionUsage(
    val totalBytes: Long,
    val usedBytes: Long,
    val remainingBytes: Long?,
    val unlimited: Boolean,
)

data class Account(
    val username: String,
    val status: String,            // ACTIVE | BLOCKED | EXPIRED | QUOTA_EXCEEDED
    val statusMessage: String,
    val quotaBytes: Long,
    val unlimited: Boolean,
    val usedBytes: Long,
    val uploadBytes: Long,
    val downloadBytes: Long,
    val remainingBytes: Long?,
    val expiresAt: Long?,
    val daysLeft: Int?,
    val usageSyncedAt: Long?,
    /** false when traffic isn't measured (manual / subscription configs) -> UI shows «حجم نامشخص», connect stays enabled */
    val usageKnown: Boolean = true,
    /** Backend-computed, display-only upstream Subscription-Userinfo; only sent when usage_known is false. */
    val subscriptionUserinfo: SubscriptionUserinfo? = null,
    val subscriptionUsage: SubscriptionUsage? = null,
) {
    val isActive get() = status == "ACTIVE"

    companion object {
        fun from(j: JSONObject) = Account(
            username = j.getString("username"),
            status = j.getString("status"),
            statusMessage = j.optString("status_message"),
            quotaBytes = j.optLong("quota_bytes"),
            unlimited = j.optBoolean("unlimited"),
            usedBytes = j.optLong("used_bytes"),
            uploadBytes = j.optLong("upload_bytes"),
            downloadBytes = j.optLong("download_bytes"),
            remainingBytes = if (j.isNull("remaining_bytes")) null else j.getLong("remaining_bytes"),
            expiresAt = if (j.isNull("expires_at")) null else j.getLong("expires_at"),
            daysLeft = if (j.isNull("days_left")) null else j.getInt("days_left"),
            usageSyncedAt = if (j.isNull("usage_synced_at")) null else j.getLong("usage_synced_at"),
            usageKnown = j.optBoolean("usage_known", true),
            subscriptionUserinfo = j.optJSONObject("subscription_userinfo")?.let(SubscriptionUserinfo::from),
        )
    }
}

/** account.subscription_userinfo: values computed by the backend from the stored Subscription-Userinfo header. */
data class SubscriptionUserinfo(
    val usedBytes: Long,
    val totalBytes: Long,
    val unlimited: Boolean,
    val remainingBytes: Long?,
    val expireAt: Long?,
    val daysLeft: Int?,
    val updatedAt: Long?,
) {
    companion object {
        fun from(j: JSONObject) = SubscriptionUserinfo(
            usedBytes = j.optLong("used_bytes"),
            totalBytes = j.optLong("total_bytes"),
            unlimited = j.optBoolean("unlimited"),
            remainingBytes = if (j.isNull("remaining_bytes")) null else j.getLong("remaining_bytes"),
            expireAt = if (j.isNull("expire_at")) null else j.getLong("expire_at"),
            daysLeft = if (j.isNull("days_left")) null else j.getInt("days_left"),
            updatedAt = if (j.isNull("updated_at")) null else j.getLong("updated_at"),
        )
    }
}

/** A server config delivered by the backend. [outbound] is a ready Xray outbound JSON (tag "proxy"). */
data class VpnConfig(
    val id: Long,
    val name: String,
    val country: String,
    val protocol: String,
    val priority: Int,
    val outbound: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("name", name).put("country", country)
        .put("protocol", protocol).put("priority", priority).put("outbound", JSONObject(outbound))

    companion object {
        fun from(j: JSONObject) = VpnConfig(
            id = j.getLong("id"),
            name = j.optString("name"),
            country = j.optString("country"),
            protocol = j.optString("protocol"),
            priority = j.optInt("priority"),
            outbound = j.getJSONObject("outbound").toString(),
        )
    }
}

data class SubscriptionItemUsage(
    val id: Long,
    val name: String,
    val uploadBytes: Long?,
    val downloadBytes: Long?,
    val totalBytes: Long?,
    val expireAt: Long?,
    val updatedAt: Long?,
) {
    val usedBytes: Long?
        get() {
            val upload = uploadBytes ?: return null
            val download = downloadBytes ?: return null
            return upload + download
        }

    val remainingBytes: Long?
        get() {
            val total = totalBytes ?: return null
            val used = usedBytes ?: return null
            return (total - used).coerceAtLeast(0L)
        }

    companion object {
        fun from(j: JSONObject) = SubscriptionItemUsage(
            id = j.getLong("id"),
            name = j.optString("name"),
            uploadBytes = if (j.isNull("upload_bytes")) null else j.getLong("upload_bytes"),
            downloadBytes = if (j.isNull("download_bytes")) null else j.getLong("download_bytes"),
            totalBytes = if (j.isNull("total_bytes")) null else j.getLong("total_bytes"),
            expireAt = if (j.isNull("expire_at")) null else j.getLong("expire_at"),
            updatedAt = if (j.isNull("updated_at")) null else j.getLong("updated_at"),
        )
    }
}

data class ConfigBundle(
    val configs: List<VpnConfig>,
    val version: String,
    val syncAfterSeconds: Int,
    val subscriptionUsage: List<SubscriptionItemUsage> = emptyList(),
    val supportTelegram: String = "@Xnetservice2",
)
/** Server-side error with a machine readable [code] (e.g. QUOTA_EXCEEDED, NO_CONFIG, UNAUTHORIZED). */
class ApiException(val httpStatus: Int, val code: String, override val message: String, val account: Account? = null) : Exception(message)
