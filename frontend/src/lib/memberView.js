// Member profile view store: any surface (roster, search, feed post,
// mentions) can ask to view a member; a single host mounted in App
// renders the overlay. Module-level pub/sub — no prop drilling through
// the router tree.

let current = null
const listeners = new Set()

export function openMember(memberId) {
  current = memberId
  listeners.forEach(fn => fn(current))
}

export function closeMember() {
  current = null
  listeners.forEach(fn => fn(current))
}

export function subscribeMemberView(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
