package ec.qrmenu.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
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
        if (!Regex("[a-zA-Z0-9_-]{1,100}").matches(event) || !Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}").matches(restaurant)) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("restaurant_updates", "Avisos del restaurante", NotificationManager.IMPORTANCE_DEFAULT))
        val target = Uri.parse("https://${BuildConfig.PLATFORM_HOST}/r/$restaurant/").buildUpon().appendQueryParameter("notification", event).appendQueryParameter("restaurant", restaurant).build()
        val intent = PendingIntent.getActivity(this, event.hashCode(), Intent(this, OwnerActivity::class.java).setData(target).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val title = message.data["title"]?.take(120) ?: "QR Menu EC"
        val body = message.data["body"]?.take(600) ?: "Abre el aviso para consultar su detalle."
        val notification = Notification.Builder(this, "restaurant_updates")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setSubText("QR Menu EC")
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(intent).setAutoCancel(true).setOnlyAlertOnce(true).build()
        manager.notify("$restaurant:$event", 1, notification)
    }
    // Token rotation is reconciled on the next authenticated panel opening.
    // No server session or password is stored in the messaging service.
}
