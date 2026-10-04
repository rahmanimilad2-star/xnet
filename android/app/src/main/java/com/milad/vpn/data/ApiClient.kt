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

    private suspend fun call(method: String, path: String, body: JSONObject? = null, auth: Boolean = true): JSONObject =
        withContext(Dispatchers.IO) {
            val rb = Request.Builder().url(baseUrl + path).header("Accept", "application/json")
            if (auth) tokenProvider()?.let { rb.header("Authorization", "Bearer $it") }
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

    suspend fun account(): Account = Account.from(call("GET", "/api/v1/account").getJSONObject("account"))

    suspend fun configs(): Pair<Account, ConfigBundle> {
        val j = call("GET", "/api/v1/configs")
        val arr = j.getJSONArray("configs")
        val list = (0 until arr.length()).map { VpnConfig.from(arr.getJSONObject(it)) }
        return Account.from(j.getJSONObject("account")) to ConfigBundle(list, j.optString("version"), j.optInt("sync_after_seconds", 300))
    }

    suspend fun event(type: String, configId: Long? = null, error: String? = null) {
        val b = JSONObject().put("type", type)
        configId?.let { b.put("config_id", it) }
        error?.let { b.put("error", it.take(300)) }
        runCatching { call("POST", "/api/v1/events", b) }
    }
}
