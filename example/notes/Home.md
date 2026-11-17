generated:: views/Home.mdx

## Thinking and plans
- [[Reading]] · 3 open · Books I am reading and what I take from them.
  collapsed:: true
	- [[Deep Work]] · 1 open · Protect long blocks of focus; I am testing two mornings a week.
	- [[Reading list]] · 2 open · What to read next; pick one when the current book is done.
- [[Website]] · 8 open · Rebuild my personal site and launch it by October 31.
  collapsed:: true
	- [[Blog migration]] · 4 open · Move 40 old posts from WordPress without breaking their links.
	  collapsed:: true
		- [[Image cleanup]] · 2 open · Swap oversized images in old posts for compressed copies.
	- [[Launch checklist]] · 4 open · What has to be true before the new site goes live.
- [[Me]] · 2 open · Errands only I can do. Agents leave these to me.
- [[Done]] · The most recently finished items.

- {{query (and "Decision:") {:title "Decisions" :collapsed? true}}}
- {{query (and "Idea:") {:title "Ideas" :collapsed? true}}}

## Work and automation
- {{query (task DOING) {:title "In progress"}}}
- {{query (and (task TODO DOING) [[agent]]) {:title "Handed to agents"}}}
- {{query (and (task WAITING) "Review:") {:title "Waiting for review"}}}
- {{query (and (task WAITING) (not "Review:")) {:title "Waiting" :collapsed? true}}}
- {{query (and [[check]]) {:title "To check" :collapsed? true}}}
