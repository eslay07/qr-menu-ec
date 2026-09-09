package ec.qrmenu.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.net.Inet4Address
import java.net.NetworkInterface

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        show()
    }

    private fun show() {
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(36, 60, 36, 40); setBackgroundColor(Color.rgb(246, 248, 242)) }
        fun text(value:String,size:Float=16f,color:Int=Color.rgb(36,65,48)){layout.addView(TextView(this).apply{text=value;textSize=size;setTextColor(color);setPadding(0,13,0,13)})}
        fun button(title:String,action:()->Unit){layout.addView(Button(this).apply{text=title;setOnClickListener{action()}})}

        text("QR Menu EC", 30f)
        text("Servidor local", 22f)
        text("Producto para atender desde la red del restaurante con el menú interactivo completo. Solo se habilita después de validar la cuenta del dueño.")
        text("Activa la Zona Wi-Fi o conecta este Android al router, inicia el servidor y usa la dirección local en los QR.", 14f)
        button("Abrir ajustes de Wi-Fi / hotspot") { startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS)) }
        val addresses = NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }.flatMap { it.inetAddresses.toList() }.filter { it is Inet4Address && it.isSiteLocalAddress }.mapNotNull { it.hostAddress }
        text(if(addresses.isEmpty()) "Activa el hotspot y pulsa Actualizar direcciones." else "Direcciones actuales:\n"+addresses.joinToString("\n"){"Demo: http://$it:8080/restaurante-demo"},13f)
        button("Iniciar servidor local") { startForegroundService(Intent(this, MenuService::class.java)); Toast.makeText(this,"Servidor local iniciado.",Toast.LENGTH_LONG).show() }
        button("Probar demo local") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:8080/restaurante-demo"))) }
        addresses.forEach { ip -> button("Mostrar QR local: $ip") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://$ip:8080/restaurante-demo/qr"))) } }
        button("Actualizar direcciones") { show() }
        button("Detener servidor local") { stopService(Intent(this, MenuService::class.java)) }
        button("Volver a mi cuenta") { finish() }
        setContentView(ScrollView(this).apply { addView(layout) })
    }
}
