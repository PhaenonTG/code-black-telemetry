package com.codeblackwx.ops.radar;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

public class RadarForegroundService extends Service {
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
