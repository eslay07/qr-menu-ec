package ec.qrmenu.app
import android.content.Context
import fi.iki.elonen.NanoHTTPD
import java.io.File
import java.net.URLConnection
import org.json.JSONObject

class MenuHttp(private val ctx:Context,private val engine:MenuEngine,port:Int,private val admin:Boolean):NanoHTTPD(port){
 override fun serve(session:IHTTPSession):Response{try{val path=session.uri;val method=session.method.name
  if(path=="/certificate"){val f=File(ctx.filesDir,"server.crt");return newFixedLengthResponse(Response.Status.OK,"application/x-x509-ca-cert",f.inputStream(),f.length())}
  if(!admin&&path.startsWith("/api/v1/")&&path!="/api/v1/menu"&&!path.startsWith("/api/v1/media/"))return error(403,"La administración requiere HTTPS en el puerto 8443.")
  if(!admin&&method!="GET")return error(405,"Solo lectura.")
  if(path.startsWith("/api/v1/")){val size=session.headers["content-length"]?.toIntOrNull()?:0;if(size>30000000||size<0)return error(413,"El archivo supera 30 MB.");val bytes=ByteArray(size);var offset=0;while(offset<size){val n=session.inputStream.read(bytes,offset,size-offset);if(n<0)return error(400,"Archivo incompleto.");offset+=n};val origin=session.headers["origin"];if(method!="GET"&&origin!=null&&origin!=(if(admin)"https://" else "http://")+session.headers["host"])return error(403,"Origen no permitido.");return engine.handle(path.removePrefix("/api/v1/"),method,session.headers,bytes,admin)}
  if(path in listOf("/portal","/generate_204","/hotspot-detect.html","/connecttest.txt"))return newFixedLengthResponse(Response.Status.REDIRECT,"text/plain","").apply{addHeader("Location","/menu")}
  if(path.contains(".."))return error(404,"No encontrado.");val asset=if(path in listOf("/","/menu","/demo","/preview"))"index.html" else path.removePrefix("/");val data=ctx.assets.open("ui/$asset").readBytes();val type=when{asset.endsWith(".js")->"text/javascript";asset.endsWith(".css")->"text/css";asset.endsWith(".svg")->"image/svg+xml";asset.endsWith(".webmanifest")->"application/manifest+json";else->URLConnection.guessContentTypeFromName(asset)?:"application/octet-stream"};return newFixedLengthResponse(Response.Status.OK,type,data.inputStream(),data.size.toLong()).apply{addHeader("X-Content-Type-Options","nosniff")}
 }catch(e:Exception){return error(400,e.message?:"No se pudo completar la operación.")}}
 private fun error(code:Int,message:String)=newFixedLengthResponse(Response.Status.lookup(code),"application/json",JSONObject().put("error",message).toString())
}
