export const PLATFORMS = [
  {
    id: 'youtube',
    name: 'YouTube',
    policyUrls: [
      'https://www.youtube.com/howyoutubeworks/policies/community-guidelines/',
      'https://support.google.com/youtube/answer/2801939',
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    policyUrls: [
      'https://www.tiktok.com/community-guidelines',
      'https://www.tiktok.com/legal/page/us/community-guidelines/en',
    ],
  },
  {
    id: 'x',
    name: 'X',
    policyUrls: [
      'https://help.x.com/en/rules-and-policies/x-rules',
      'https://help.x.com/en/rules-and-policies/abusive-behavior',
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    policyUrls: [
      'https://transparency.meta.com/policies/community-standards/',
      'https://help.instagram.com/477434105621119',
    ],
  },
  {
    id: 'other',
    name: 'Other',
    policyUrls: [
      'https://www.youtube.com/howyoutubeworks/policies/community-guidelines/',
      'https://www.tiktok.com/community-guidelines',
    ],
  },
];

// Public pages GenLayer can fetch (do NOT use example.com — web.render fails).
// Hosts must differ from each platform's authoritative policy hosts.
export const SAMPLE_FLAGGED_URLS = [
  'https://en.wikipedia.org/wiki/YouTube',
  'https://en.wikipedia.org/wiki/Content_moderation',
];

export const FUND_PRESETS = ['1', '5', '10', '50'];
