package ec.qrmenu.app
import org.junit.Test
import org.junit.Assert.*
class AndroidWindowPolicyTest {
    @Test fun foregroundChecksRepeatWithoutDuplicateRequests() {
        val gate = UpdateCheckGate()
        assertTrue(gate.begin()); assertFalse(gate.begin()); gate.complete(); assertFalse(gate.begin())
        gate.background(); assertTrue(gate.begin()); assertFalse(gate.begin()); gate.complete(); assertFalse(gate.begin())
    }
    @Test fun reopeningWhileRequestRunsIsCoalescedThenRetried() {
        val gate = UpdateCheckGate(); assertTrue(gate.begin()); gate.background(); assertFalse(gate.begin())
        gate.complete(); assertTrue(gate.begin()); gate.complete(); assertFalse(gate.begin())
    }
    @Test fun offlineCompletionAllowsNextForegroundRetry() {
        val gate = UpdateCheckGate(); assertTrue(gate.begin()); gate.complete(); gate.background(); assertTrue(gate.begin())
    }
    @Test fun cutoutAndKeyboardUseMaximumWithoutDoublePadding() {
        val bars = SafeArea(0,24,0,34); val cutout = SafeArea(16,40,0,0)
        assertEquals(SafeArea(16,40,0,34), safeArea(bars,cutout,0))
        assertEquals(SafeArea(16,40,0,300), safeArea(bars,cutout,300))
        assertEquals(SafeArea(0,0,0,0), safeArea(SafeArea(0,0,0,0),SafeArea(0,0,0,0),0))
    }
}
