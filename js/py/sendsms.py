"""`from sendsms import sendsms` - not available.

The fork's src/lib/sendsms.py is three lines:

    import csinsc
    def sendsms(number, text):
        csinsc.sendsms(number, text)

but `csinsc.sendsms` is **commented out** in the fork - it sits inside a
triple-quoted block - so calling this has raised AttributeError for as long as
the module has existed. No curriculum file imports it.

Kept as a module so `import sendsms` still succeeds, but saying plainly what is
going on. Sending an SMS needs a paid gateway and a server endpoint; if that is
ever wanted it is a new feature, not a port.
"""


def sendsms(number, text):
    raise NotImplementedError(
        "sendsms() is not available. It has never worked - the function it "
        "calls is commented out in the Skulpt library too.")
