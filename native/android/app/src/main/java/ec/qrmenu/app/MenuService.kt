package ec.qrmenu.app
import android.app.*
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import android.content.Context
import java.io.File
import java.net.NetworkInterface
import java.security.*
import java.security.cert.X509Certificate
import java.math.BigInteger
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.*
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import android.util.Base64

class MenuService:Service(){private var publicServer:MenuHttp?=null;private var adminServer:MenuHttp?=null;private var wake:PowerManager.WakeLock?=null
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
  if(intent?.action=="stop"){stopSelf();return START_NOT_STICKY}
  if(publicServer!=null)return START_STICKY
  val nm=getSystemService(NotificationManager::class.java);nm.createNotificationChannel(NotificationChannel("server","Servidor del menú",NotificationManager.IMPORTANCE_LOW))
  val launch=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE)
  val stop=PendingIntent.getService(this,1,Intent(this,MenuService::class.java).setAction("stop"),PendingIntent.FLAG_IMMUTABLE)
  if(intent?.action=="stop"){stopSelf();return START_NOT_STICKY}
  startForeground(1,Notification.Builder(this,"server").setContentTitle("QR Menu EC está iniciando").setContentText("Servidor local del restaurante").setSmallIcon(android.R.drawable.ic_menu_view).setContentIntent(launch).addAction(Notification.Action.Builder(null,"Detener",stop).build()).build())
  Thread{try{val engine=MenuEngine(this);val ssl=certificate();adminServer=MenuHttp(this,engine,8443,true).apply{makeSecure(ssl.serverSocketFactory,null);start(15000,false)};publicServer=MenuHttp(this,engine,8080,false).apply{start(15000,false)};wake=(getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"qrmenu:server").apply{acquire()};nm.notify(1,Notification.Builder(this,"server").setContentTitle("QR Menu EC está disponible").setContentText("Hotspot o Wi-Fi activo. Mantén este equipo cargando.").setSmallIcon(android.R.drawable.ic_menu_view).setContentIntent(launch).addAction(Notification.Action.Builder(null,"Detener",stop).build()).build())}catch(e:Exception){nm.notify(2,Notification.Builder(this,"server").setContentTitle("No se pudo iniciar QR Menu EC").setContentText(e.message).setSmallIcon(android.R.drawable.ic_dialog_alert).setContentIntent(launch).build());stopSelf()}}.start()
  return START_STICKY
 }
 override fun onDestroy(){publicServer?.stop();adminServer?.stop();wake?.let{if(it.isHeld)it.release()};publicServer=null;adminServer=null;super.onDestroy()}
 private fun certificate():SSLContext{val file=File(filesDir,"server.p12");val secretFile=File(filesDir,"tls-secret");if(!secretFile.exists())secretFile.writeText(java.util.UUID.randomUUID().toString());val pass=secretFile.readText().toCharArray();val ks=KeyStore.getInstance("PKCS12")
  if(file.exists())file.inputStream().use{ks.load(it,pass)}else{ks.load(null,pass);val generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);val pair=generator.generateKeyPair();val subject=X500Name("CN=QR Menu Administracion local");val builder=JcaX509v3CertificateBuilder(subject,BigInteger(128,SecureRandom()),Date(System.currentTimeMillis()-3600000),Date(System.currentTimeMillis()+157680000000L),subject,pair.public);val addresses=NetworkInterface.getNetworkInterfaces().toList().flatMap{it.inetAddresses.toList()}.filter{it.hostAddress?.contains(':')==false}.mapNotNull{it.hostAddress};val names=mutableListOf(GeneralName(GeneralName.dNSName,"localhost"),GeneralName(GeneralName.dNSName,"menu.lan"),GeneralName(GeneralName.iPAddress,"127.0.0.1"));addresses.forEach{names.add(GeneralName(GeneralName.iPAddress,it))};builder.addExtension(Extension.subjectAlternativeName,false,GeneralNames(names.toTypedArray()));builder.addExtension(Extension.basicConstraints,true,BasicConstraints(true));builder.addExtension(Extension.keyUsage,true,KeyUsage(KeyUsage.digitalSignature or KeyUsage.keyCertSign));val provider=BouncyCastleProvider();val signer=JcaContentSignerBuilder("SHA256withRSA").setProvider(provider).build(pair.private);val cert=JcaX509CertificateConverter().setProvider(provider).getCertificate(builder.build(signer));ks.setKeyEntry("server",pair.private,pass,arrayOf(cert));file.outputStream().use{ks.store(it,pass)};File(filesDir,"server.crt").writeText("-----BEGIN CERTIFICATE-----\n"+Base64.encodeToString(cert.encoded,Base64.DEFAULT)+"-----END CERTIFICATE-----\n")}
  val km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());km.init(ks,pass);return SSLContext.getInstance("TLS").apply{init(km.keyManagers,null,SecureRandom())}
 }
}
