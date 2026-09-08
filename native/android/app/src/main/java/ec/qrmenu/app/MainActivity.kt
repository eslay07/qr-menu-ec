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

        text("QR Menu Resuelven", 30f)
        text("Panel del dueño", 22f)
        text("Modifica platos, precios, fotos y genera los dos QR desde tu cuenta. El creador controla tu acceso y las funciones habilitadas.")
        button("ADMINISTRAR MI RESTAURANTE") { startActivity(Intent(this, OwnerActivity::class.java)) }
        text("Necesitas Internet para guardar cambios en Cloudflare. El QR de texto que imprimas sí funciona sin Internet para tus clientes.", 13f, Color.DKGRAY)

        text("Respaldo local por hotspot", 20f)
        text("Esta función piloto anterior se conserva para pruebas locales: activa Zona Wi-Fi, inicia el servidor y conecta el celular del cliente a esa red.", 14f)
        button("Abrir ajustes de Wi-Fi / hotspot") { startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS)) }
        val addresses = NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }.flatMap { it.inetAddresses.toList() }.filter { it is Inet4Address && it.isSiteLocalAddress }.mapNotNull { it.hostAddress }
        text(if(addresses.isEmpty()) "Activa el hotspot y pulsa Actualizar direcciones." else "Direcciones actuales:\n"+addresses.joinToString("\n"){"Demo: http://$it:8080/restaurante-demo"},13f)
        button("Iniciar servidor local") { startForegroundService(Intent(this, MenuService::class.java)); Toast.makeText(this,"Servidor local iniciado.",Toast.LENGTH_LONG).show() }
        button("Probar demo local") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:8080/restaurante-demo"))) }
        addresses.forEach { ip -> button("Mostrar QR local: $ip") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://$ip:8080/restaurante-demo/qr"))) } }
        button("Actualizar direcciones") { show() }
        button("Detener servidor local") { stopService(Intent(this, MenuService::class.java)) }
        setContentView(ScrollView(this).apply { addView(layout) })
    }
}
