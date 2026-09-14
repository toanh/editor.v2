def add(a, b):
    total = a + b
    return total

def shout(word):
    loud = word.upper()
    return loud + "!"

result = add(2, 3)
message = shout("hi")
print(result, message)
