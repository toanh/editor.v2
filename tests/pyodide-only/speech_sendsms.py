# speech needs a microphone and sendsms has never worked. What can be checked
# is that both import, that the module surface is what the lessons expect, and
# that the dead one says so plainly instead of raising AttributeError.
import inspect

import speech
import sendsms

print("speech import * gives:", sorted(speech.__all__))
print("say signature :", str(inspect.signature(speech.say)))
print("listen sig    :", str(inspect.signature(speech.listen)))

# speech.say is deliberately NOT csinsc.say - no warm-up utterance, no
# language argument - because the two are used by different lessons.
import csinsc
print("distinct from csinsc.say:", speech.say is not csinsc.say)
print("csinsc.say sig:", str(inspect.signature(csinsc.say)))

try:
    sendsms.sendsms("0400000000", "hello")
    print("sendsms returned - unexpected")
except NotImplementedError as exc:
    print("sendsms:", exc)
