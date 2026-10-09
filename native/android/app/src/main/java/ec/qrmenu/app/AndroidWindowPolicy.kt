package ec.qrmenu.app

/** One request per foreground visit, with at most one request in flight. */
internal class UpdateCheckGate {
    private var requested = true
    private var inFlight = false
    @Synchronized fun background() { requested = true }
    @Synchronized fun begin(): Boolean {
        if (!requested || inFlight) return false
        requested = false; inFlight = true; return true
    }
    @Synchronized fun complete() { inFlight = false }
}

internal data class SafeArea(val left: Int, val top: Int, val right: Int, val bottom: Int)
internal fun safeArea(bars: SafeArea, cutout: SafeArea, keyboardBottom: Int): SafeArea = SafeArea(
    maxOf(bars.left, cutout.left), maxOf(bars.top, cutout.top), maxOf(bars.right, cutout.right), maxOf(bars.bottom, cutout.bottom, keyboardBottom)
)
