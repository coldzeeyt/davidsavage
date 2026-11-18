// Starting content. Everything here is editable from /edit.
module.exports = {
  version: 1,
  meta: {
    title: 'David Savage',
    description: 'The homepage of David Savage: music, apps, and everything else I make.'
  },
  hero: {
    eyebrow: 'Music · Apps · Everything else',
    kicker: 'the homepage of',
    name: 'David Savage',
    bio: 'I make music as **8 Arcades** and **minnit**, build odd little corners of the internet under **Halfbyte**, and own way too many CDs. Everything I\'ve made lives on this page.',
    primary: { label: "See what I've built", link: '#builds' },
    secondary: { label: 'Listen to matchbook', link: 'https://open.spotify.com/artist/5niUb4Wj0YwUCGTfzI4GW7' }
  },
  nowSpinning: {
    label: 'Now spinning',
    title: 'wait a minnit',
    sub: 'minnit · matchbook EP',
    coverLabel: 'Same Room Records',
    coverText: 'MATCH\nBOOK',
    cover: 'ember',
    image: '',
    link: 'https://open.spotify.com/artist/5niUb4Wj0YwUCGTfzI4GW7'
  },
  rightNow: {
    label: 'Right now',
    statuses: [
      { id: 's1', icon: 'hammer', text: 'Building a new app', note: 'Probably up too late doing it' },
      { id: 's2', icon: 'video', text: 'Recording a video', note: '' },
      { id: 's3', icon: 'headphones', text: 'Making a beat', note: '' },
      { id: 's4', icon: 'pen-line', text: 'Writing Anniversary', note: 'with Fish' }
    ],
    activeId: 's1',
    previousId: 's2',
    setAt: Date.now(),
    clearAfterHours: 0,
    showInTicker: true
  },
  ticker: {
    label: 'Right now',
    hidden: false,
    items: [
      { id: 't1', icon: 'audio-lines', verb: 'Writing', text: 'Anniversary with Fish', when: 'this week' },
      { id: 't2', icon: 'disc-3', verb: 'Digging', text: 'through a crate of CDs', when: 'this week' },
      { id: 't3', icon: 'gamepad-2', verb: 'Playing', text: 'Geometry Dash, building a level', when: 'lately' }
    ]
  },
  order: ['projects', 'notes', 'gpt', 'music', 'socials', 'guestbook'],
  sections: {
    projects: {
      title: 'Things I built', em: '& still build', hidden: false,
      items: [
        { id: 'p1', title: 'Crossjam', desc: 'Real-time shared YouTube listening rooms. Express + Socket.io backend, turntable-themed front end.', link: '', tags: ['Live', 'Railway'], width: 'xl', thumb: 'turntable', thumbText: '', image: '', hidden: false },
        { id: 'p2', title: 'TuneSwitcher', desc: 'Move playlists between Spotify, Apple Music and YouTube. Built with Seb.', link: 'https://tuneswitcher.lol', tags: ['tuneswitcher.lol'], width: 'l', thumb: 'playlists', thumbText: '', image: '', hidden: false },
        { id: 'p3', title: 'DJ Scratchy Pants', desc: 'Booking site with a scratchable record, Web Audio beat engine and EQ visualizer.', link: 'https://djscratchypants.com', tags: ['Client'], width: 'm', thumb: 'eq', thumbText: '', image: '', hidden: false },
        { id: 'p4', title: 'Playform Studio', desc: 'Start your own game studio in the browser. Getting rebuilt from the ground up.', link: 'https://playform-studio-production.up.railway.app/', tags: ['In progress'], width: 'm', thumb: 'tiles', thumbText: '', image: '', hidden: false },
        { id: 'p5', title: 'Freq', desc: 'Short video tuned like a radio. Flip stations, no AI slop.', link: '', tags: ['Coming soon'], width: 'm', thumb: 'dial', thumbText: '', image: '', hidden: false },
        { id: 'p6', title: 'Aperture', desc: 'A browser camera that feels like a real one.', link: '', tags: ['Halfbyte'], width: 's', thumb: 'aperture', thumbText: '', image: '', hidden: false },
        { id: 'p7', title: 'Reach', desc: 'Calculator number game with streaks.', link: '', tags: ['Halfbyte'], width: 's', thumb: 'number', thumbText: '1,024', image: '', hidden: false },
        { id: 'p8', title: 'Dash Zone', desc: 'Four original levels, procedural music.', link: '', tags: ['Halfbyte'], width: 's', thumb: 'cube', thumbText: '', image: '', hidden: false },
        { id: 'p9', title: 'The Toolbox', desc: 'SuperWeb, ZLE, CONVERT, TRIAD and the rest.', link: 'https://coldzeeyt.github.io', tags: ['Halfbyte'], width: 's', thumb: 'text', thumbText: '+12 MORE', image: '', hidden: false }
      ]
    },
    notes: {
      title: "David's comments", em: 'notes from me', hidden: false,
      pinned: "Everything I make ends up here eventually. The finished stuff, the broken stuff, and the stuff I swear I'll finish.",
      handle: '@coldzeeyt',
      posts: []
    },
    gpt: {
      title: 'DavidGPT', em: 'ask me anything', hidden: false,
      head1: 'Not AI.', head2: 'Just me.',
      blurb: 'Ask DavidGPT anything and the answer comes from me, typed by hand. Usually within a day. The good ones get pinned for everyone.',
      replyTime: 'usually answers in a few hours',
      starters: [
        { icon: 'music', text: "What's the difference between 8 Arcades and minnit?" },
        { icon: 'hammer', text: 'What are you building right now?' },
        { icon: 'audio-lines', text: 'What have you been listening to lately?' },
        { icon: 'mail', text: 'Can I hire you to make my site?' }
      ],
      allowAnonymous: false
    },
    music: {
      title: 'Music', em: 'on Same Room Records', hidden: false,
      items: [
        { id: 'm1', coverLabel: 'minnit', coverText: 'MATCH\nBOOK', cover: 'ember', image: '', badge: 'Out now', title: 'matchbook — EP', sub: 'minnit · 6 songs · Nov 2026', link: '', tracks: [{ name: 'wait a minnit', meta: '01' }] },
        { id: 'm2', coverLabel: 'Instrumentals', coverText: '8\nARCADES', cover: 'ocean', image: '', badge: '', title: '8 Arcades', sub: 'Singles & a new era', link: 'https://open.spotify.com/artist/5niUb4Wj0YwUCGTfzI4GW7', tracks: [{ name: 'DEALER', meta: 'New' }, { name: 'BIG MAC BIG BACKS', meta: 'Single' }, { name: 'ABDUCTION', meta: 'Single' }, { name: 'SNAPSHOTS', meta: 'Single' }] },
        { id: 'm3', coverLabel: '8 Arcades', coverText: 'ANNIVERSARY', cover: 'prism', image: '', badge: 'Coming soon', title: 'Anniversary', sub: 'The next one. Feat. Fish', link: '', tracks: [] }
      ]
    },
    socials: {
      title: 'Find me', em: 'elsewhere', hidden: false,
      items: [
        { id: 'l1', icon: 'square-play', label: 'YouTube', sub: 'davidiotgt', link: 'https://www.youtube.com/@davidiotgt' },
        { id: 'l2', icon: 'code-xml', label: 'GitHub', sub: 'coldzeeyt', link: 'https://github.com/coldzeeyt' },
        { id: 'l3', icon: 'audio-lines', label: 'Spotify', sub: '8 Arcades', link: 'https://open.spotify.com/artist/5niUb4Wj0YwUCGTfzI4GW7' },
        { id: 'l4', icon: 'clapperboard', label: 'YouTube II', sub: 'coldzeegt', link: 'https://www.youtube.com/@coldzeegt' }
      ]
    },
    guestbook: {
      title: 'Guestbook', em: 'say something', hidden: false,
      head: 'Leave a note', sub: 'Say hi, request a song, or roast my code.',
      requireApproval: true
    }
  }
};
