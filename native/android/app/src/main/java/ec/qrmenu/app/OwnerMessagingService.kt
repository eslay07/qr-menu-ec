package ec.qrmenu.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class OwnerMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val preferences = getSharedPreferences("owner_push", MODE_PRIVATE)
        if (!preferences.getBoolean("enabled", false)) return
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val restaurant = message.data["restaurantId"] ?: return
        val event = message.data["eventId"] ?: return
        if (restaurant != preferences.getString("restaurantId", "")) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("restaurant_updates", "Avisos del restaurante", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = PendingIntent.getActivity(this, 0, Intent(this, OwnerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, "restaurant_updates")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("QR Menu EC")
            .setContentText("Tienes una novedad en tu restaurante. Abre el panel para revisarla.")
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(intent).setAutoCancel(true).setOnlyAlertOnce(true).build()
        manager.notify("$restaurant:$event", 1, notification)
    }
    // Token rotation is reconciled on the next authenticated panel opening.
    // No server session or password is stored in the messaging service.
}
