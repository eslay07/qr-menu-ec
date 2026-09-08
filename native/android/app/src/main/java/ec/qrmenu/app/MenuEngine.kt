package ec.qrmenu.app
import android.content.Context
import android.util.Base64
import android.util.AtomicFile
import fi.iki.elonen.NanoHTTPD
import org.json.*
import java.io.File
import java.util.UUID
import java.time.Instant
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters

class MenuEngine(private val ctx:Context){private val file=AtomicFile(File(ctx.filesDir,"state.json"));private var stored:JSONObject?=if(file.baseFile.exists())JSONObject(String(file.readFully(),Charsets.UTF_8))else null;private val media=File(ctx.filesDir,"media").apply{mkdirs()};private val setup=File(ctx.filesDir,"installation-code.txt").let{if(!it.exists())it.writeText(token());it.readText()};private val key=runCatching{ctx.assets.open("seller-public.txt").bufferedReader().readText().trim()}.getOrDefault("")
 private fun arr(a:JSONArray):List<JSONObject> =(0 until a.length()).map{a.getJSONObject(it)}
 private fun strings(a:JSONArray):List<String> =(0 until a.length()).map{a.getString(it)}
 private fun token():String=Base64.encodeToString(ByteArray(32).apply{SecureRandom().nextBytes(this)},Base64.NO_WRAP or Base64.URL_SAFE)
 private fun hash(s:String)=Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(s.toByteArray()),Base64.NO_WRAP)
 private fun equal(a:String,b:String)=MessageDigest.isEqual(a.toByteArray(),b.toByteArray())
 private fun password(p:String,salt:String)=Base64.encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(p.toCharArray(),salt.toByteArray(),100000,256)).encoded,Base64.NO_WRAP)
 private fun now()=Instant.now().toString()
 private fun validAsset(p:String)=p.isEmpty()||p=="/demo/encebollado.jpg"||Regex("^/api/v1/media/[a-f0-9-]{36}$").matches(p)
 private fun validate(c:JSONObject){require(c.getString("name").trim().isNotEmpty()&&c.getString("name").length<=80);require(c.getString("tagline").length<=180&&Regex("^#[a-fA-F0-9]{6}$").matches(c.getString("color"))&&validAsset(c.getString("logo")));val categories=arr(c.getJSONArray("categories"));require(categories.size in 1..30);val ids=categories.map{it.getString("id")};require(ids.toSet().size==ids.size);categories.forEach{require(Regex("^[a-zA-Z0-9_-]{1,80}$").matches(it.getString("id")));require(it.getString("name").trim().isNotEmpty()&&it.getString("name").length<=50)};val dishes=arr(c.getJSONArray("dishes"));require(dishes.size<=150&&dishes.map{it.getString("id")}.toSet().size==dishes.size);dishes.forEach{d->require(Regex("^[a-zA-Z0-9_-]{1,80}$").matches(d.getString("id")));require(d.getString("name").trim().isNotEmpty()&&d.getString("name").length<=90&&d.getString("description").length<=500&&d.getString("categoryId") in ids);val price=d.getDouble("priceCents");require(price>=0&&price<=9999999&&price==price.toInt().toDouble());require(validAsset(d.getString("image")));d.getBoolean("available")}}
 private fun settings(s:JSONObject){require(s.getString("mode") in listOf("web","text","local"));require(s.getString("server") in listOf("router","windows7","windows10","android"));require(s.getString("accessExperience") in listOf("automatic_preferred","guided"));require(s.getString("ssid").toByteArray().size in 1..32);require(Regex("^[\\x20-\\x7e]{8,63}$").matches(s.getString("wifiPassword")));val url=java.net.URI(s.getString("localUrl"));require(url.scheme=="http"&&url.userInfo==null&&url.query==null&&url.fragment==null);require(url.host=="menu.lan"||Regex("^(10\\.[0-9.]+|192\\.168\\.[0-9.]+|172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9.]+)$").matches(url.host));if(s.getString("webUrl").isNotEmpty()){val u=java.net.URI(s.getString("webUrl"));require(u.scheme=="https"&&u.host!=null&&u.userInfo==null)}}
 private fun assets(c:JSONObject):List<String> =(listOf(c.getString("logo"))+arr(c.getJSONArray("dishes")).map{it.getString("image")}).filter{it.startsWith("/api/v1/media/")}.map{it.substringAfterLast('/')}.distinct()
 private fun license(l:JSONObject?,id:String):List<String>{if(l==null)return emptyList();require(key.isNotEmpty()){ "Falta configurar la clave pública del vendedor." };val bytes=Base64.decode(l.getString("payload"),Base64.DEFAULT);val signer=Ed25519Signer();signer.init(false,Ed25519PublicKeyParameters(Base64.decode(key,Base64.DEFAULT),0));signer.update(bytes,0,bytes.size);require(signer.verifySignature(Base64.decode(l.getString("signature"),Base64.DEFAULT))){"Firma de licencia inválida."};val p=JSONObject(String(bytes,Charsets.UTF_8));require(p.getInt("schemaVersion")==1&&p.getString("restaurantId")==id){"La licencia pertenece a otro restaurante."};require(p.getString("customer").isNotBlank());UUID.fromString(p.getString("licenseId"));Instant.parse(p.getString("issuedAt"));val modes=strings(p.getJSONArray("modes"));require(modes.size in 1..3&&modes.all{it in listOf("local","web","text")});return modes}
 private fun save(s:JSONObject){val next=JSONObject().put("revision",(stored?.getInt("revision")?:-1)+1).put("state",s);val out=file.startWrite();try{out.write(next.toString().toByteArray());file.finishWrite(out);stored=next}catch(e:Exception){file.failWrite(out);throw e}}
 private fun sessionToken(s:JSONObject,expires:Long)="$expires."+hash(s.getJSONObject("password").getString("hash")+":"+s.getInt("sessionEpoch")+":"+expires)
 private fun authed(s:JSONObject,h:Map<String,String>):Boolean{val cookie=h["cookie"]?.split(';')?.map{it.trim()}?.firstOrNull{it.startsWith("qrmenu_session=")}?.substringAfter('=')?:return false;val expires=cookie.substringBefore('.').toLongOrNull()?:return false;return expires>System.currentTimeMillis()&&expires<System.currentTimeMillis()+86400001&&equal(cookie,sessionToken(s,expires))}
 private fun response(v:Any,status:Int=200):NanoHTTPD.Response=NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.lookup(status),"application/json; charset=utf-8",v.toString()).apply{addHeader("Cache-Control","no-store");addHeader("X-Content-Type-Options","nosniff")}
 private fun error(status:Int,message:String)=response(JSONObject().put("error",message),status)
 private fun ok()=JSONObject().put("ok",true)
 private fun cookie(s:JSONObject,response:NanoHTTPD.Response):NanoHTTPD.Response=response.apply{addHeader("Set-Cookie","qrmenu_session="+sessionToken(s,System.currentTimeMillis()+86400000)+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400")}
 private fun imageValid(b:ByteArray,type:String)=b.size in 13..1000000&&((type=="image/jpeg"&&b[0].toInt() and 255==255&&b[1].toInt() and 255==216)||(type=="image/png"&&b[0].toInt() and 255==137&&b[1].toInt()==80)||(type=="image/webp"&&String(b.copyOfRange(0,4))=="RIFF"&&String(b.copyOfRange(8,12))=="WEBP"))
 private fun textPages(c: JSONObject): List<String> {
  val maxBytes = 900
  fun footer(part: Int, total: Int) = "\n\nPARTE $part DE $total"
  val limit = maxBytes - footer(150, 150).toByteArray().size
  val pages = mutableListOf<String>()
  var text = c.getString("name") + "\nMENÚ · PRECIOS EN USD"
  var hasDish = false
  var currentCategory = ""
  arr(c.getJSONArray("categories")).forEach { category ->
   arr(c.getJSONArray("dishes")).filter { dish ->
    dish.getString("categoryId") == category.getString("id") && dish.getBoolean("available")
   }.forEach { dish ->
    val dishName = dish.getString("name")
    val item = "- $dishName: $" + String.format(java.util.Locale.US, "%.2f", dish.getInt("priceCents") / 100.0)
    var addition = if (currentCategory == category.getString("id")) "\n$item" else "\n\n${category.getString("name")}\n$item"
    if ((text + addition).toByteArray().size > limit) {
     require(hasDish) { "El texto de $dishName es demasiado largo para un QR legible." }
     pages.add(text)
     text = c.getString("name") + "\nMENÚ · CONTINUACIÓN"
     hasDish = false
     currentCategory = ""
     addition = "\n\n${category.getString("name")}\n$item"
     require((text + addition).toByteArray().size <= limit) { "El texto de $dishName es demasiado largo para un QR legible." }
    }
    text += addition
    hasDish = true
    currentCategory = category.getString("id")
   }
  }
  if (hasDish) pages.add(text)
  return pages.mapIndexed { index, page -> page + footer(index + 1, pages.size) }
 }
 private fun writeMedia(id:String,type:String,b:ByteArray){File(media,id).writeBytes(b);File(media,"$id.type").writeText(type)}
 @Synchronized fun handle(path:String,method:String,h:Map<String,String>,bytes:ByteArray,admin:Boolean):NanoHTTPD.Response{try{
  var s=stored?.getJSONObject("state")?.let{JSONObject(it.toString())};val b=if(bytes.isNotEmpty()&&path!="media")JSONObject(String(bytes,Charsets.UTF_8))else JSONObject();val revision=stored?.getInt("revision")?:0
  if(path=="session"&&method=="GET")return response(JSONObject().put("configured",s!=null).put("authenticated",s!=null&&authed(s,h)).put("platformSetup",false).put("runtime","local"))
  if(path=="setup"&&method=="POST"){if(s!=null)return error(409,"Ya está configurado.");require(equal(b.optString("setupToken"),setup)){"Código de instalación incorrecto."};val p=b.getString("password");require(p.length in 12..128&&b.getString("name").trim().isNotEmpty()&&b.getString("name").length<=80);val salt=token();val recovery=token();s=JSONObject().put("schemaVersion",1).put("restaurantId",UUID.randomUUID().toString()).put("ownerId","local-owner").put("draft",JSONObject("""{"name":"Restaurante","tagline":"Sabores que nos reúnen.","color":"#244130","logo":"","categories":[{"id":"principales","name":"Platos principales"},{"id":"bebidas","name":"Bebidas"}],"dishes":[]}""").put("name",b.getString("name"))).put("settings",JSONObject("""{"mode":"text","server":"android","accessExperience":"automatic_preferred","ssid":"QR-Menu","wifiPassword":"menu-invitados","localUrl":"http://192.168.8.1:8080/menu","webUrl":""}""")).put("published",JSONObject.NULL).put("license",JSONObject.NULL).put("password",JSONObject().put("salt",salt).put("hash",password(p,salt))).put("recoveryHash",hash(recovery)).put("sessionEpoch",0).put("failures",JSONObject().put("count",0).put("until",0)).put("createdAt",now());save(s);return cookie(s,response(JSONObject().put("recovery",recovery).put("restaurantId",s.getString("restaurantId")),201))}
  if(s==null)return error(404,"Configura primero el restaurante.")
  if(path in listOf("login","recover")&&method=="POST"){val failures=s.getJSONObject("failures");if(failures.getLong("until")>System.currentTimeMillis())return error(429,"Demasiados intentos. Espera 15 minutos.");val p=b.getString("password");require(p.length<=128);val valid=if(path=="login")equal(password(p,s.getJSONObject("password").getString("salt")),s.getJSONObject("password").getString("hash"))else equal(hash(b.getString("recovery")),s.getString("recoveryHash"));if(!valid){val count=failures.getInt("count")+1;failures.put("count",count);if(count>=5)failures.put("until",System.currentTimeMillis()+900000);save(s);return error(401,"Credenciales incorrectas.")};failures.put("count",0).put("until",0);val out=ok();if(path=="recover"){require(p.length>=12);val salt=token();val recovery=token();s.put("password",JSONObject().put("salt",salt).put("hash",password(p,salt))).put("sessionEpoch",s.getInt("sessionEpoch")+1).put("recoveryHash",hash(recovery));out.put("recovery",recovery)};save(s);return cookie(s,response(out))}
  val modes=runCatching{license(s.optJSONObject("license"),s.getString("restaurantId"))}.getOrDefault(emptyList());val publication=s.optJSONObject("published")
  if(path=="menu"&&method=="GET"){if(publication==null)return error(404,"El restaurante todavía no ha publicado su menú.");if(publication.getString("mode") !in modes||publication.getString("mode")=="text")return error(403,"La modalidad interactiva no está habilitada.");return response(JSONObject(publication.toString()).put("accessExperience",s.getJSONObject("settings").getString("accessExperience")))}
  if(path.startsWith("media/")&&method=="GET"){val id=path.removePrefix("media/");require(Regex("^[a-f0-9-]{36}$").matches(id));val isPublic=publication!=null&&publication.getString("mode") in modes&&id in assets(publication.getJSONObject("catalog"));if(!isPublic&&!authed(s,h))return error(401,"Imagen privada.");val f=File(media,id);if(!f.exists())return error(404,"Imagen no encontrada.");return NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK,File(media,"$id.type").readText(),f.inputStream(),f.length()).apply{addHeader("X-Content-Type-Options","nosniff");addHeader("Cache-Control",if(isPublic)"public, max-age=86400" else "no-store")}}
  if(!authed(s,h))return error(401,"Inicia sesión para administrar el restaurante.")
  when{
   path=="state"&&method=="GET"->return response(JSONObject().put("restaurantId",s.getString("restaurantId")).put("revision",revision).put("draft",s.getJSONObject("draft")).put("settings",s.getJSONObject("settings")).put("published",publication?:JSONObject.NULL).put("licensedModes",JSONArray(modes)).put("hasLicense",s.optJSONObject("license")!=null).put("createdAt",s.getString("createdAt")))
   path=="logout"&&method=="POST"->{s.put("sessionEpoch",s.getInt("sessionEpoch")+1);save(s);return response(ok()).apply{addHeader("Set-Cookie","qrmenu_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0")}}
   path=="draft"&&method=="PUT"->{if(b.getInt("revision")!=revision)return error(409,"Hay cambios de otro dispositivo. Recarga.");validate(b.getJSONObject("catalog"));s.put("draft",b.getJSONObject("catalog"));save(s);return response(JSONObject().put("revision",revision+1))}
   path=="settings"&&method=="PUT"->{if(b.getInt("revision")!=revision)return error(409,"Hay cambios de otro dispositivo.");val value=b.getJSONObject("settings");settings(value);if(value.getString("mode")!=s.getJSONObject("settings").getString("mode")&&value.getString("mode") !in modes)return error(403,"Esta modalidad requiere una ampliación de licencia.");s.put("settings",value);save(s);return response(JSONObject().put("revision",revision+1))}
   path=="license"&&method=="POST"->{license(b,s.getString("restaurantId"));s.put("license",b);save(s);return response(ok())}
   path=="publish"&&method=="POST"->{if(b.getInt("revision")!=revision)return error(409,"Guarda o recarga antes de publicar.");val config=s.getJSONObject("settings");if(config.getString("mode") !in modes)return error(403,"Importa la licencia antes de publicar.");val draft=s.getJSONObject("draft");require(draft.getJSONArray("dishes").length()>0){"Añade al menos un plato."};require(assets(draft).all{File(media,it).exists()}){"Faltan fotos del borrador."};val version=(publication?.getInt("version")?:0)+1;s.put("published",JSONObject().put("version",version).put("at",now()).put("catalog",JSONObject(draft.toString())).put("mode",config.getString("mode")).put("accessExperience",config.getString("accessExperience")));save(s);return response(JSONObject().put("version",version))}
   path=="media"&&method=="POST"->{val type=h["content-type"]?:"";require(imageValid(bytes,type)){"Solo fotos JPG, PNG o WebP de hasta 1 MB."};val id=UUID.randomUUID().toString();writeMedia(id,type,bytes);return response(JSONObject().put("url","/api/v1/media/$id"),201)}
   path=="backup"&&method=="GET"->{val draft=s.getJSONObject("draft");val images=JSONArray();assets(draft).forEach{id->images.put(JSONObject().put("id",id).put("type",File(media,"$id.type").readText()).put("data",Base64.encodeToString(File(media,id).readBytes(),Base64.NO_WRAP)))};return response(JSONObject().put("schemaVersion",1).put("sourceId",s.getString("restaurantId")).put("exportedAt",now()).put("draft",draft).put("settings",s.getJSONObject("settings")).put("media",images))}
   path=="restore"&&method=="POST"->{require(b.getInt("schemaVersion")==1);val draft=b.getJSONObject("draft");validate(draft);val config=b.getJSONObject("settings");settings(config);val photos=arr(b.getJSONArray("media"));require(photos.size<=151);val mapped=mutableMapOf<String,String>();val data=mutableMapOf<String,ByteArray>();photos.forEach{val id=it.getString("id");require(Regex("^[a-f0-9-]{36}$").matches(id));val bytes=Base64.decode(it.getString("data"),Base64.DEFAULT);require(imageValid(bytes,it.getString("type")));mapped[id]=UUID.randomUUID().toString();data[id]=bytes};require(assets(draft).all{mapped.containsKey(it)}){"Faltan fotos en el respaldo."};photos.forEach{val id=it.getString("id");writeMedia(mapped.getValue(id),it.getString("type"),data.getValue(id))};
fun rewrite(p:String):String { return if(p.startsWith("/api/v1/media/"))"/api/v1/media/"+mapped.getValue(p.substringAfterLast('/'))else p }
draft.put("logo",rewrite(draft.getString("logo")));arr(draft.getJSONArray("dishes")).forEach{it.put("image",rewrite(it.getString("image")))};if(config.getString("mode") !in modes)config.put("mode",s.getJSONObject("settings").getString("mode"));s.put("draft",draft).put("settings",config);save(s);return response(ok().put("notice","Borrador restaurado. Revisa y publica. Licencia y contraseña conservadas."))}
   path=="qr"&&method=="GET"->{val config=s.getJSONObject("settings");val mode=config.getString("mode");if(mode !in modes)return error(403,"Activa la modalidad antes de generar tarjetas comerciales.");if(publication==null||publication.getString("mode")!=mode)return error(400,"Publica primero esta modalidad.");val texts=mutableListOf<String>();if(mode=="local"){
fun esc(v:String):String { return v.replace("\\","\\\\").replace(";","\\;").replace(":","\\:").replace(",","\\,").replace("\"","\\\"").replace(" ","\\ ") }
texts.add("WIFI:T:WPA;S:"+esc(config.getString("ssid"))+";P:"+esc(config.getString("wifiPassword"))+";;")}else if(mode=="web"){require(config.getString("webUrl").isNotEmpty()){"Configura la dirección HTTPS del menú."};texts.add(config.getString("webUrl"))}else{texts.addAll(textPages(publication.getJSONObject("catalog")));require(texts.isNotEmpty()){"Marca al menos un plato como disponible y vuelve a publicar el menú."}};val codes=JSONArray();texts.forEach{codes.put(JSONObject().put("payload",it))};return response(JSONObject().put("codes",codes).put("mode",mode).put("name",publication.getJSONObject("catalog").getString("name")).put("version",publication.getInt("version")).put("settings",config))}
   path=="health"&&method=="GET"->return response(JSONObject().put("runtime","local").put("server","android").put("portal","not_verified").put("certified",false).put("checkedAt",now()))
  };return error(404,"Ruta no encontrada.")
 }catch(e:Exception){return error(400,if(e is IllegalArgumentException&&e.message=="Failed requirement.")"Revisa los datos y los límites del formulario." else e.message?:"No se pudo completar la operación.")}}
}
