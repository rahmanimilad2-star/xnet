package com.milad.vpn.data

import com.milad.vpn.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiClient(private val baseUrl: String = BuildConfig.API_BASE_URL, private val tokenProvider: () -> String?) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private suspend fun call(method: String, path: String, body: JSONObject? = null, auth: Boolean = true, bearer: String? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val rb = Request.Builder().url(baseUrl + path).header("Accept", "application/json")
            if (auth) (bearer ?: tokenProvider())?.let { rb.header("Authorization", "Bearer $it") }
            when (method) {
                "GET" -> rb.get()
                else -> rb.method(method, (body ?: JSONObject()).toString().toRequestBody(jsonType))
            }
            val resp = try {
                http.newCall(rb.build()).execute()
            } catch (e: IOException) {
                throw ApiException(0, "NETWORK", "اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید.")
            }
            resp.use {
                val text = it.body?.string().orEmpty()
                val json = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
                if (!it.isSuccessful) {
                    val err = json.optJSONObject("error")
                    val acc = err?.optJSONObject("account")?.let { a -> Account.from(a) }
                    throw ApiException(
                        it.code,
                        err?.optString("code")?.takeIf { c -> c.isNotBlank() } ?: "HTTP_${it.code}",
                        err?.optString("message")?.takeIf { m -> m.isNotBlank() } ?: "خطای سرور (${it.code})",
                        acc,
                    )
                }
                json
            }
        }

    suspend fun login(username: String, password: String): Pair<String, Account> {
        val j = call("POST", "/api/v1/auth/login", JSONObject().put("username", username).put("password", password), auth = false)
        return j.getString("token") to Account.from(j.getJSONObject("account"))
    }

    /** Frees this device's server session. true = server reached (it always answers 200), false = offline. */
    suspend fun logout(token: String): Boolean = try {
        call("POST", "/api/v1/auth/logout", JSONObject(), bearer = token); true
    } catch (e: ApiException) { e.code != "NETWORK" }

    /** true if our backend answered at all (any HTTP status) over the real network; false = unreachable. */
    suspend fun reachable(): Boolean = try {
        call("GET", "/api/v1/account"); true
    } catch (e: ApiException) { e.code != "NETWORK" }

    suspend fun account(): Account = Account.from(call("GET", "/api/v1/account").getJSONObject("account"))
    /** Refresh the authenticated user's private subscription on our backend, then read configs(). */
    suspend fun refreshSubscription() { call("POST", "/api/v1/subscriptions/refresh") }


    suspend fun configs(): Pair<Account, ConfigBundle> {
        val j = call("GET", "/api/v1/configs")
        val arr = j.getJSONArray("configs")
        val list = (0 until arr.length()).map { VpnConfig.from(arr.getJSONObject(it)) }

        val usageArr = j.optJSONArray("subscription_usage")
        val subscriptionUsage = if (usageArr == null) {
            emptyList()
        } else {
            (0 until usageArr.length()).map {
                SubscriptionItemUsage.from(usageArr.getJSONObject(it))
            }
        }

        val account = Account.from(j.getJSONObject("account"))
        val accountSubscriptionUsage = subscriptionUsage
            .singleOrNull()
            ?.let { sub ->
                val total = sub.totalBytes ?: 0L
                val used = sub.usedBytes ?: 0L
                val unlimited = total <= 0L
                SubscriptionUsage(
                    totalBytes = total,
                    usedBytes = used,
                    remainingBytes = if (unlimited) null else sub.remainingBytes,
                    unlimited = unlimited,
                )
            }

        return account.copy(subscriptionUsage = accountSubscriptionUsage) to ConfigBundle(
            configs = list,
            version = j.optString("version"),
            syncAfterSeconds = j.optInt("sync_after_seconds", 300),
            subscriptionUsage = subscriptionUsage,
            supportTelegram = j.optString("support_telegram", "@Xnetservice2"),
        )
    }

    suspend fun event(type: String, configId: Long? = null, error: String? = null) {
        val b = JSONObject().put("type", type)
        configId?.let { b.put("config_id", it) }
        error?.let { b.put("error", it.take(300)) }
        runCatching { call("POST", "/api/v1/events", b) }
    }
}
