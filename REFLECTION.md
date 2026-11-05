# Reflection

### What assumptions did you make?

Going in, I assumed this service would end up needing to handle logging into the portal itself — some kind of login flow, storing a session, maybe refreshing it when it expired. That turned out to be the wrong mental model. Once it was clear the whole point was to never touch a portal credential directly, the design flipped: the caller holds their own session and passes it through on every request, and the service stays completely stateless about auth. It's a simpler system than the one I originally pictured, but it took sitting with that constraint for a bit to actually see it.

### Which part was the most difficult, and how did you get unstuck?

The hardest part was figuring out whether a single meter's full hierarchy — installType, build, the whole zone-to-DT chain — was available live anywhere, or whether I was just missing the right endpoint. It would have been easy to assume it existed somewhere and keep digging indefinitely, or to assume it didn't and be wrong about that too. What actually got me unstuck was getting a raw capture of the meter search response and going through it field by field. Once I could see exactly what came back and what didn't, it stopped being a guess and became a fact I could design around — the single-meter endpoint only has the live fields, and hierarchy/installType/build have to come from the bulk export snapshot instead.

### If you had another day, what would you improve?

Two things. First, caching — right now every single request goes straight to the live portal, even for data that barely changes, which is fine for a take-home but wouldn't hold up under real traffic. Second, the pagination and bulk-handling is uneven across endpoints: some list endpoints are properly paginated, while others (like meters under one transformer) just return everything in one response because the dataset happened to be small enough to get away with it. With another day I'd make that consistent instead of leaving it dependent on how big the current dataset happens to be.

### What mistake did you make while solving this?

I added a new export route in the wrong order relative to an existing one. Express matches routes top to bottom, and the new route would have been silently shadowed by an existing dynamic route that matches anything — including the new route's literal path name. It wouldn't have thrown an error; it just would have quietly done the wrong thing. I caught it on a second read-through before it shipped, which is the kind of bug that's obvious once you see it and invisible until you specifically go looking for it.

### If you were reviewing your own submission, what would you criticise?

Two things, honestly. First, how much of this was built with AI assistance rather than typed out by hand line by line — I think that's worth being upfront about rather than letting the finished repo speak for itself, and I'd expect a reviewer to ask follow-up questions to see how much I actually understand versus what I directed. Second, the hierarchy/installType/build data comes from a one-time snapshot file, not a live source, and nothing in the system currently flags if that snapshot drifts out of date as the portal's topology changes over time. It works fine for the data as it stood when captured, but it's a quiet assumption baked into the design that a reviewer should know about.
