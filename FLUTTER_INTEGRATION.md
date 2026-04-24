# Flutter Integration Guide — TTL Dashboard Features

This document covers the recommended approach for integrating the TTL Team Dashboard features into the existing Flutter/Firebase TTL mobile app.

---

## Strategy: Supabase as a Feature Module

Keep Firebase for all existing features (auth, news, podcasts, video, community chat). Add Supabase as a dedicated module for race and team features. Bridge the two auth systems via Firebase JWT so users only log in once.

```
Existing TTL App (Flutter)
│
├── Firebase Auth          ← single sign-on, unchanged
├── Firestore              ← news, posts, podcasts, video (unchanged)
├── Firebase Cloud Messaging ← push notifications (unchanged)
│
└── Supabase Module (NEW)
    ├── Race Calendar      ← IRONMAN, 70.3, Olympic, Sprint events
    ├── Race Entries       ← who's racing which race
    ├── Team Roster        ← profiles, avatars
    ├── Messaging          ← channels, messages, reactions, mentions
    └── My Races           ← personal schedule + iCal export
```

---

## Part 1 — JWT Bridge (Firebase → Supabase)

This is the core integration piece. Firebase Auth issues JWTs when a user logs in. Supabase can be configured to trust those tokens, so users authenticate once with Firebase and Supabase accepts the same identity.

### Step 1 — Configure Supabase to trust Firebase JWTs

In your Supabase dashboard go to **Settings → API → JWT Settings** and set the JWT secret to match your Firebase project's signing key.

Firebase uses RS256 (asymmetric) signing. Supabase supports this via JWKS. Set the JWKS URL to:

```
https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
```

Then set the JWT audience to your Firebase project ID (e.g. `ttl-prod-12345`).

### Step 2 — Get the Firebase ID token in Flutter

```dart
import 'package:firebase_auth/firebase_auth.dart';

Future<String?> getFirebaseToken() async {
  final user = FirebaseAuth.instance.currentUser;
  if (user == null) return null;
  // Force refresh to ensure token is fresh
  return await user.getIdToken(true);
}
```

### Step 3 — Initialize Supabase with the Firebase token

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> initSupabase() async {
  await Supabase.initialize(
    url: 'https://your-project-ref.supabase.co',
    anonKey: 'your-anon-key',
  );
}

// Call after Firebase login — sets Supabase session using Firebase JWT
Future<void> signIntoSupabase() async {
  final firebaseToken = await getFirebaseToken();
  if (firebaseToken == null) return;

  await Supabase.instance.client.auth.signInWithIdToken(
    provider: OAuthProvider.google, // placeholder — we're using custom JWT
    idToken: firebaseToken,
  );
}
```

> **Note:** For custom JWT auth, use `Supabase.instance.client.auth.setSession()` with the Firebase token directly if `signInWithIdToken` doesn't support your flow. The Supabase Flutter SDK also accepts a custom access token via the `accessToken` parameter on the client initializer in newer versions.

### Step 4 — Refresh the Supabase token when Firebase refreshes

Firebase tokens expire after 1 hour. Listen for refresh events and update Supabase:

```dart
FirebaseAuth.instance.idTokenChanges().listen((user) async {
  if (user != null) {
    final newToken = await user.getIdToken(true);
    // Update Supabase session with new token
    await Supabase.instance.client.auth.setSession(newToken);
  }
});
```

### Step 5 — Sync user profile on first login

The first time a Firebase user accesses Supabase features, create their profile:

```dart
Future<void> ensureSupabaseProfile() async {
  final firebaseUser = FirebaseAuth.instance.currentUser;
  if (firebaseUser == null) return;

  final supabase = Supabase.instance.client;

  final existing = await supabase
      .from('profiles')
      .select('id')
      .eq('id', firebaseUser.uid) // use Firebase UID as Supabase profile id
      .maybeSingle();

  if (existing == null) {
    await supabase.from('profiles').insert({
      'id': firebaseUser.uid,
      'full_name': firebaseUser.displayName ?? firebaseUser.email?.split('@').first,
      'email': firebaseUser.email,
      'role': 'athlete',
    });
  }
}
```

> **Important:** The Supabase `profiles` table currently uses Supabase Auth UUIDs as the primary key. For the Firebase bridge, you have two options:
> - Use the Firebase UID as the profile ID (requires changing the `profiles` table to use `text` instead of `uuid` for the id column)
> - Maintain a mapping table `firebase_supabase_users (firebase_uid text, supabase_id uuid)`
>
> Option 1 is simpler. Option 2 keeps the schema cleaner if you plan a full migration later.

---

## Part 2 — Flutter Package Setup

Add Supabase to the existing Flutter project:

```yaml
# pubspec.yaml — add to dependencies
dependencies:
  supabase_flutter: ^2.3.0
```

```bash
flutter pub get
```

Initialize alongside Firebase in `initialize.dart`:

```dart
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> initialize() async {
  // Existing Firebase setup
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  // Add Supabase initialization
  await Supabase.initialize(
    url: const String.fromEnvironment('SUPABASE_URL'),
    anonKey: const String.fromEnvironment('SUPABASE_ANON_KEY'),
  );

  // Existing app check, crashlytics etc.
  // ...
}
```

Pass environment variables at build time:

```bash
flutter run --dart-define=SUPABASE_URL=https://your-ref.supabase.co \
            --dart-define=SUPABASE_ANON_KEY=your-anon-key
```

Or store them in `.env` files using `flutter_dotenv`.

---

## Part 3 — Feature Module Structure

Add a `racing/` module to the existing project structure:

```
lib/
├── feed/                  # existing
├── podcast/               # existing
├── video/                 # existing
│
└── racing/                # NEW — all dashboard features
    ├── services/
    │   ├── supabase_service.dart      # Supabase client singleton + auth bridge
    │   ├── race_service.dart          # Race queries — fetch, filter, search
    │   ├── entry_service.dart         # Race entries — enter, withdraw
    │   └── messaging_service.dart     # Channels, messages, real-time
    │
    ├── models/
    │   ├── race_model.dart            # Race data model
    │   ├── race_entry_model.dart      # Entry data model
    │   ├── channel_model.dart         # Messaging channel
    │   └── message_model.dart         # Message with reply + reactions
    │
    └── views/
        ├── race_home_page.dart        # This week's races + map
        ├── race_list_page.dart        # Full race calendar with filters
        ├── race_detail_sheet.dart     # Bottom sheet — course, teammates
        ├── my_races_page.dart         # Personal schedule
        ├── messaging_page.dart        # Channel list + thread view
        └── team_roster_page.dart      # Team members
```

---

## Part 4 — Key Service Implementations

### Race Service

```dart
class RaceService {
  final _client = Supabase.instance.client;

  Future<List<Map<String, dynamic>>> getUpcomingRaces({
    String? source,
    String? type,
    String? search,
  }) async {
    var query = _client
        .from('races')
        .select('*')
        .gte('race_date', DateTime.now().toIso8601String().split('T').first)
        .order('race_date');

    if (source != null && source != 'all') {
      query = query.eq('source', source);
    }
    if (type != null && type != 'all') {
      query = query.eq('type', type);
    }
    if (search != null && search.isNotEmpty) {
      query = query.or(
        'name.ilike.%$search%,location.ilike.%$search%,type.ilike.%$search%'
      );
    }

    final response = await query;
    return List<Map<String, dynamic>>.from(response);
  }

  Future<void> enterRace(String raceId, String athleteId) async {
    await _client.from('race_entries').insert({
      'race_id': raceId,
      'athlete_id': athleteId,
    });
  }

  Future<void> withdrawFromRace(String raceId, String athleteId) async {
    await _client
        .from('race_entries')
        .delete()
        .eq('race_id', raceId)
        .eq('athlete_id', athleteId);
  }
}
```

### Real-time Messaging

```dart
class MessagingService {
  final _client = Supabase.instance.client;
  RealtimeChannel? _subscription;

  Stream<List<Map<String, dynamic>>> messagesStream(String channelId) {
    return _client
        .from('messages')
        .stream(primaryKey: ['id'])
        .eq('channel_id', channelId)
        .order('created_at')
        .map((rows) => rows);
  }

  Future<void> sendMessage({
    required String channelId,
    required String athleteId,
    String? content,
    String? imageUrl,
    String? replyTo,
  }) async {
    await _client.from('messages').insert({
      'channel_id': channelId,
      'athlete_id': athleteId,
      'content': content,
      'image_url': imageUrl,
      'reply_to': replyTo,
    });
  }

  Future<void> toggleReaction({
    required String messageId,
    required String athleteId,
    required String emoji,
  }) async {
    final existing = await _client
        .from('message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('athlete_id', athleteId)
        .eq('emoji', emoji)
        .maybeSingle();

    if (existing != null) {
      await _client.from('message_reactions').delete().eq('id', existing['id']);
    } else {
      await _client.from('message_reactions').insert({
        'message_id': messageId,
        'athlete_id': athleteId,
        'emoji': emoji,
      });
    }
  }

  void dispose() {
    _subscription?.unsubscribe();
  }
}
```

---

## Part 5 — Navigation Integration

Add the racing features as a new tab in `home_page.dart` alongside the existing News, Chat, Listen, Watch tabs:

```dart
// home_page.dart — add to existing tab list
BottomNavigationBarItem(
  icon: Icon(Icons.directions_bike_outlined),
  activeIcon: Icon(Icons.directions_bike),
  label: 'Racing',
),

// Add to tab body
case 4: // Racing tab
  return const RaceHomePage();
```

Or add as a standalone section accessible from the profile/menu rather than a bottom tab, to avoid cluttering the existing nav.

---

## Part 6 — Push Notifications

FCM is already set up in the app. When the Meta WhatsApp integration is enabled, race weekend alerts can be sent via Firebase Cloud Messaging instead — no additional setup needed.

From the Supabase scraper, replace the WhatsApp call with an FCM HTTP v1 API call to your Firebase project. This keeps notifications inside the existing infrastructure:

```javascript
// In scraper.js — alternative to WhatsApp when Meta is approved
async function sendFCMNotification(message, topic = 'race-alerts') {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FIREBASE_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          topic,
          notification: { title: 'Race Weekend 🏁', body: message },
          data: { type: 'race_alert' },
        }
      }),
    }
  );
}
```

Users subscribe to the `race-alerts` FCM topic on app launch:

```dart
await FirebaseMessaging.instance.subscribeToTopic('race-alerts');
```

---

## Part 7 — Schema Changes Required for Firebase Bridge

Run these in Supabase SQL Editor before starting the integration:

```sql
-- Allow text IDs to support Firebase UIDs (if using Option 1 from Part 1)
-- Only needed if using Firebase UIDs directly as profile IDs
-- Skip if using a mapping table instead

-- Add firebase_uid column to profiles for the mapping approach
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS firebase_uid text unique;
CREATE INDEX IF NOT EXISTS idx_profiles_firebase_uid ON profiles(firebase_uid);

-- Update RLS policies to support both auth systems
-- (Supabase will handle this automatically once JWT bridge is configured)
```

---

## Part 8 — Environment Configuration

Add to your Flutter CI/CD and local dev setup:

| Variable | Where | Description |
|----------|-------|-------------|
| `SUPABASE_URL` | `--dart-define` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `--dart-define` | Supabase public anon key |

Separate values for debug and prod Supabase projects (mirror the existing Firebase debug/prod split):

```bash
# Debug
flutter run --flavor debug \
  -t lib/main_debug.dart \
  --dart-define=SUPABASE_URL=https://debug-ref.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=debug-anon-key

# Production
flutter run --flavor prod \
  -t lib/main_prod.dart \
  --dart-define=SUPABASE_URL=https://prod-ref.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=prod-anon-key
```

---

## Migration Phases

### Phase 1 — JWT Bridge + Profile Sync (Week 1–2)
- Configure Supabase to trust Firebase JWTs
- Add Supabase Flutter SDK to the project
- Implement `ensureSupabaseProfile()` on login
- Verify auth bridge works end to end

### Phase 2 — Race Features (Week 3–4)
- Add `racing/` module to the Flutter project
- Implement race list, race detail, and entry toggle
- Add Racing tab to bottom navigation
- Wire up My Races and personal schedule

### Phase 3 — Messaging (Week 5–6)
- Implement messaging service with real-time subscriptions
- Build channel list and message thread UI
- Add @mentions and replies
- Connect race threads to race detail screen

### Phase 4 — Notifications (when Meta Business approved)
- Enable WhatsApp notifications via Meta Cloud API, or
- Use FCM topic messaging as described in Part 6

### Phase 5 — Full Migration (future, optional)
- Migrate community chat from Firestore to Supabase messaging
- Migrate user profiles from Firebase Auth to Supabase Auth
- Migrate news/posts from Firestore to PostgreSQL
- Decommission Firebase

---

## Key Contacts & Resources

- Supabase Flutter SDK docs: https://supabase.com/docs/reference/dart/introduction
- Supabase Firebase migration guide: https://supabase.com/docs/guides/migrations/firebase-auth
- Firebase custom JWT with Supabase: https://supabase.com/docs/guides/auth/third-party/firebase-auth
- Flutter Supabase realtime: https://supabase.com/docs/guides/realtime/flutter

---

*This document should be handed to the Flutter developer alongside the main README.md and the Supabase schema.sql.*
