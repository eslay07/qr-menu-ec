package ec.qrmenu.app
import org.junit.Test
import org.junit.Assert.fail
class UpdatePolicyTest {
    private val hash = "a".repeat(64)
    private val cert = "b".repeat(64)
    private fun check(url: String = "https://example.test/downloads/app.apk", size: Long = 1024, digest: String = hash, signer: String = cert) = UpdatePolicy.validate(url, "example.test", size, digest, signer, setOf(cert))
    private fun rejects(block: () -> Unit) { try { block(); fail("Unsafe update accepted") } catch (_: IllegalArgumentException) {} }
    @Test fun acceptsSameOriginSignedBoundedRelease() { check(); check(size = 30L*1024*1024) }
    @Test fun rejectsNetworkOriginAndCredentials() {
        listOf("http://example.test/a.apk", "https://evil.test/a.apk", "https://example.test.evil/a.apk", "https://user@example.test/a.apk", "https://example.test:443/a.apk", "https://example.test/a.apk#fragment").forEach { rejects { check(url = it) } }
    }
    @Test fun rejectsUnboundedSizeHashAndOtherSigner() {
        listOf(0L, -1L, 30L*1024*1024+1).forEach { rejects { check(size = it) } }
        rejects { check(digest = "bad") }; rejects { check(signer = "c".repeat(64)) }
    }
    @Test fun rejectsCorruptedOrWrongPackageArchive() {
        fun archive(pkg: String = "ec.qrmenu.app", version: Long = 16, signer: String = cert, size: Long = 1024, receivedHash: String = hash) = UpdatePolicy.validateArchive(pkg, "ec.qrmenu.app", version, 16, 15, setOf(signer), setOf(cert), cert, size, 1024, receivedHash, hash)
        archive()
        rejects { archive(pkg = "malware.other") }; rejects { archive(version = 15) }; rejects { archive(version = 17) }
        rejects { archive(signer = "c".repeat(64)) }; rejects { archive(size = 1023) }; rejects { archive(receivedHash = "d".repeat(64)) }
    }
}
