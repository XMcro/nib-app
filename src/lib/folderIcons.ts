/*! Folder icons: drawings from Lucide (https://lucide.dev), lucide-static 1.62.0.
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/**
 * The icons a folder can have (lib/folderSettings, Nib Plus), each by its
 * Lucide name, as kept, with what it's called and its drawing on a 24-unit
 * square, in strokes of 2. None is one of those Lucide takes from Feather, so
 * the notice above is the whole of what they ask. A folder with none has
 * Nib's own (Places' FolderIcon).
 */
export type Shape = [tag: string, attributes: Record<string, string>]

export const FOLDER_ICONS: Record<string, { label: string; shapes: Shape[] }> = {
  'book': { label: 'Book', shapes: [['path', {'d': 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20'}]] },
  'book-open': { label: 'Open book', shapes: [['path', {'d': 'M12 5v16'}], ['path', {'d': 'M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z'}]] },
  'notebook-pen': { label: 'Notebook', shapes: [['path', {'d': 'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4'}], ['path', {'d': 'M2 6h4'}], ['path', {'d': 'M2 10h4'}], ['path', {'d': 'M2 14h4'}], ['path', {'d': 'M2 18h4'}], ['path', {'d': 'M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z'}]] },
  'pen-line': { label: 'Pen', shapes: [['path', {'d': 'M13 21h8'}], ['path', {'d': 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'}]] },
  'scroll-text': { label: 'Scroll', shapes: [['path', {'d': 'M15 12h-5'}], ['path', {'d': 'M15 8h-5'}], ['path', {'d': 'M19 17V5a2 2 0 0 0-2-2H4'}], ['path', {'d': 'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3'}]] },
  'file-text': { label: 'Page', shapes: [['path', {'d': 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'}], ['path', {'d': 'M14 2v5a1 1 0 0 0 1 1h5'}], ['path', {'d': 'M10 9H8'}], ['path', {'d': 'M16 13H8'}], ['path', {'d': 'M16 17H8'}]] },
  'mail': { label: 'Letter', shapes: [['path', {'d': 'm22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7'}], ['rect', {'x': '2', 'y': '4', 'width': '20', 'height': '16', 'rx': '2'}]] },
  'quote': { label: 'Quote', shapes: [['path', {'d': 'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'}], ['path', {'d': 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'}]] },
  'message-circle': { label: 'Speech', shapes: [['path', {'d': 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719'}]] },
  'users': { label: 'People', shapes: [['path', {'d': 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'}], ['path', {'d': 'M16 3.128a4 4 0 0 1 0 7.744'}], ['path', {'d': 'M22 21v-2a4 4 0 0 0-3-3.87'}], ['circle', {'cx': '9', 'cy': '7', 'r': '4'}]] },
  'lightbulb': { label: 'Idea', shapes: [['path', {'d': 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'}], ['path', {'d': 'M9 18h6'}], ['path', {'d': 'M10 22h4'}]] },
  'sparkles': { label: 'Sparkles', shapes: [['path', {'d': 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z'}], ['path', {'d': 'M20 2v4'}], ['path', {'d': 'M22 4h-4'}], ['circle', {'cx': '4', 'cy': '20', 'r': '2'}]] },
  'star': { label: 'Star', shapes: [['path', {'d': 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'}]] },
  'heart': { label: 'Heart', shapes: [['path', {'d': 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'}]] },
  'bookmark': { label: 'Bookmark', shapes: [['path', {'d': 'M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z'}]] },
  'library': { label: 'Books', shapes: [['path', {'d': 'm16 6 4 14'}], ['path', {'d': 'M12 6v14'}], ['path', {'d': 'M8 8v12'}], ['path', {'d': 'M4 4v16'}]] },
  'graduation-cap': { label: 'School', shapes: [['path', {'d': 'M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z'}], ['path', {'d': 'M22 10v6'}], ['path', {'d': 'M6 12.5V16a6 3 0 0 0 12 0v-3.5'}]] },
  'briefcase': { label: 'Work', shapes: [['path', {'d': 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'}], ['rect', {'width': '20', 'height': '14', 'x': '2', 'y': '6', 'rx': '2'}]] },
  'house': { label: 'Home', shapes: [['path', {'d': 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'}], ['path', {'d': 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'}]] },
  'plane': { label: 'Travel', shapes: [['path', {'d': 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'}]] },
  'globe': { label: 'Globe', shapes: [['circle', {'cx': '12', 'cy': '12', 'r': '10'}], ['path', {'d': 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'}], ['path', {'d': 'M2 12h20'}]] },
  'coffee': { label: 'Coffee', shapes: [['path', {'d': 'M10 2v2'}], ['path', {'d': 'M14 2v2'}], ['path', {'d': 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1'}], ['path', {'d': 'M6 2v2'}]] },
  'utensils-crossed': { label: 'Food', shapes: [['path', {'d': 'm16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8'}], ['path', {'d': 'M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7'}], ['path', {'d': 'm2.1 21.8 6.4-6.3'}], ['path', {'d': 'm19 5-7 7'}]] },
  'sprout': { label: 'Seedling', shapes: [['path', {'d': 'M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3'}], ['path', {'d': 'M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4'}], ['path', {'d': 'M5 21h14'}]] },
  'sun': { label: 'Sun', shapes: [['circle', {'cx': '12', 'cy': '12', 'r': '4'}], ['path', {'d': 'M12 2v2'}], ['path', {'d': 'M12 20v2'}], ['path', {'d': 'm4.93 4.93 1.41 1.41'}], ['path', {'d': 'm17.66 17.66 1.41 1.41'}], ['path', {'d': 'M2 12h2'}], ['path', {'d': 'M20 12h2'}], ['path', {'d': 'm6.34 17.66-1.41 1.41'}], ['path', {'d': 'm19.07 4.93-1.41 1.41'}]] },
  'moon-star': { label: 'Night', shapes: [['path', {'d': 'M18 5h4'}], ['path', {'d': 'M20 3v4'}], ['path', {'d': 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401'}]] },
  'camera': { label: 'Camera', shapes: [['path', {'d': 'M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z'}], ['circle', {'cx': '12', 'cy': '13', 'r': '3'}]] },
  'palette': { label: 'Art', shapes: [['path', {'d': 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z'}], ['circle', {'cx': '13.5', 'cy': '6.5', 'r': '.5', 'fill': 'currentColor'}], ['circle', {'cx': '17.5', 'cy': '10.5', 'r': '.5', 'fill': 'currentColor'}], ['circle', {'cx': '6.5', 'cy': '12.5', 'r': '.5', 'fill': 'currentColor'}], ['circle', {'cx': '8.5', 'cy': '7.5', 'r': '.5', 'fill': 'currentColor'}]] },
  'clapperboard': { label: 'Film', shapes: [['path', {'d': 'm12.296 3.464 3.02 3.956'}], ['path', {'d': 'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z'}], ['path', {'d': 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'}], ['path', {'d': 'm6.18 5.276 3.1 3.899'}]] },
  'rocket': { label: 'Rocket', shapes: [['path', {'d': 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'}], ['path', {'d': 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09'}], ['path', {'d': 'M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z'}], ['path', {'d': 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05'}]] },
  'sword': { label: 'Sword', shapes: [['path', {'d': 'm11 19-6-6'}], ['path', {'d': 'm5 21-2-2'}], ['path', {'d': 'm8 16-4 4'}], ['path', {'d': 'M9.5 17.5 20.414 6.586A2 2 0 0021 5.172V3h-2.172a2 2 0 00-1.414.586L6.5 14.5'}]] },
}
