package ec.qrmenu.app
import java.net.URI
internal object UpdatePolicy {
    fun validate(url: String, host: String, size: Long, hash: String, certificate: String, installedCertificates: Set<String>) {
        val uri = URI(url)
        require(uri.scheme == "https" && uri.host == host && uri.port == -1 && uri.userInfo == null && uri.fragment == null)
        require(size in 1..30L*1024*1024)
        require(hash.matches(Regex("[a-f0-9]{64}")))
        require(installedCertificates == setOf(certificate))
    }
    fun validateArchive(packageName: String, expectedPackage: String, version: Long, expectedVersion: Int, installedVersion: Int, signers: Set<String>, installedSigners: Set<String>, expectedSigner: String, receivedSize: Long, expectedSize: Long, receivedHash: String, expectedHash: String) {
        require(packageName == expectedPackage && version == expectedVersion.toLong() && version > installedVersion)
        require(signers == installedSigners && signers == setOf(expectedSigner))
        require(receivedSize == expectedSize && receivedHash == expectedHash)
    }
}
