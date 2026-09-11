# The speech path has two protections that are easy to lose in a port and
# impossible to notice without a microphone, so they are asserted here instead.
#
#   * a profanity filter - this is a product for primary schools and the
#     computer says whatever a child types
#   * a language table - say(..., language="french") must speak French, and an
#     unknown language must raise rather than silently speaking English
#
# Both live in the host bridge. The utterance itself is intercepted so nothing
# has to be audible for this to be checked.
import js
import csinsc
import speech

spoken = []
_real = js.window.speechSynthesis.speak
js.window.speechSynthesis.speak = lambda u: spoken.append((u.text, u.lang))

csinsc.firstUtterance = False          # skip the lazy-load warm-up utterance
csinsc.say("hello there")
csinsc.say("bonjour", 0, "french")
csinsc.say("guten tag", 0, "german")
speech.say("plain speech module")

# A word from the filter list. The reply is chosen at random, so assert that it
# is *not* the original rather than which refusal came back.
csinsc.say("you are a bastard")

try:
    csinsc.say("hola", 0, "klingon")
    print("unknown language did not raise")
except Exception as exc:
    print("unknown language raises:", type(exc).__name__)

js.window.speechSynthesis.speak = _real

# The refusal is picked at random, so normalise it - the assertion is that the
# original text did not survive, not which reply came back.
REFUSALS = {"nice try", "better luck next time",
            "do you talk to your grandmother with that foul language?",
            "ah nope", "HELP! this student is trying to swear",
            "get back to work please"}
for text, lang in spoken:
    shown = "<refused>" if text in REFUSALS else text
    print("spoke:", repr(shown), "lang:", repr(lang))
