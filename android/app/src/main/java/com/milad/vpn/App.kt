package com.milad.vpn

import android.app.Application
import com.milad.vpn.data.Repository
import com.milad.vpn.vpn.XrayCore

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Repository.init(this)
        XrayCore.init(this)
    }
}
