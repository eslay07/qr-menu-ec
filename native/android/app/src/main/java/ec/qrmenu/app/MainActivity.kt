package ec.qrmenu.app
import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import android.widget.*
import android.graphics.Color
import android.net.Uri
import java.net.NetworkInterface
import java.io.File

class MainActivity:Activity(){
 override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),1);show()}
 private fun show(){val layout=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(36,60,36,30);setBackgroundColor(Color.rgb(246,248,242))};fun text(value:String,size:Float=16f){layout.addView(TextView(this).apply{text=value;textSize=size;setTextColor(Color.rgb(36,65,48));setPadding(0,16,0,16)})};fun button(title:String,action:()->Unit){layout.addView(Button(this).apply{text=title;setOnClickListener{action()}})}
 text("qrmenú",38f);text("Tu celular, el servidor de tu restaurante.",22f);text("Conecta este Android al router del restaurante. Mantén el equipo cargando y permite que la aplicación permanezca activa.")
 val addresses=NetworkInterface.getNetworkInterfaces().toList().flatMap{it.inetAddresses.toList()}.filter{!it.isLoopbackAddress&&it.hostAddress?.contains(':')==false}.mapNotNull{it.hostAddress};text("Direcciones actuales:\n"+addresses.joinToString("\n"){"Menú: http://$it:8080/menu\nPanel: https://$it:8443/"})
 button("Iniciar servidor"){startForegroundService(Intent(this,MenuService::class.java));Toast.makeText(this,"Iniciando. Abre el panel cuando aparezca la notificación.",Toast.LENGTH_LONG).show()}
 button("Abrir panel del dueño"){startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://127.0.0.1:8443/")))}
 button("Mostrar código de instalación"){val f=File(filesDir,"installation-code.txt");text(if(f.exists())f.readText() else "Inicia primero el servidor.")}
 button("Ver certificado de administración"){val f=File(filesDir,"server.crt");if(f.exists()){val hash=java.security.MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString(""){"%02x".format(it)};text("Certificado público: http://${addresses.firstOrNull()?:"127.0.0.1"}:8080/certificate\nSHA-256 del archivo: $hash",12f)}else text("Inicia primero el servidor.")}
 button("Actualizar direcciones"){show()};button("Detener servidor"){stopService(Intent(this,MenuService::class.java))};text("El portal automático necesita un router compatible configurado. Un hotspot común no garantiza su apertura. La administración usa un certificado local que debe confiarse en los dispositivos del dueño.",13f)
 setContentView(ScrollView(this).apply{addView(layout)})
 }
}
