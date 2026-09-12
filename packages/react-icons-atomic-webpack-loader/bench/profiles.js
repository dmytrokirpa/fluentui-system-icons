const TOOLBAR_ICONS = [
  'AddFilled',
  'ArrowLeftRegular',
  'BackpackFilled',
  'CalculatorFilled',
  'CalendarFilled',
  'CameraFilled',
  'CheckmarkFilled',
  'ChevronDownFilled',
  'ClockFilled',
  'CopyFilled',
  'DeleteFilled',
  'DismissFilled',
  'DocumentFilled',
  'EditFilled',
  'FilterFilled',
  'FolderFilled',
  'GlobeFilled',
  'HomeFilled',
  'ImageFilled',
  'SearchFilled',
];

const GRID_KINDS = [
  'Add',
  'ArrowLeft',
  'Backpack',
  'Calculator',
  'Calendar',
  'Camera',
  'Checkmark',
  'ChevronDown',
  'Clock',
  'Copy',
  'Delete',
  'Dismiss',
  'Document',
  'Edit',
  'Filter',
  'Folder',
  'Globe',
  'Home',
  'Image',
  'Info',
  'Link',
  'Mail',
  'MoreHorizontal',
  'People',
  'Person',
  'Search',
  'Settings',
  'Share',
  'Star',
  'Warning',
];

const HERO_ICONS = ['AccessTimeFilled', 'StarFilled', 'WarningFilled'];

/** @type {Record<string, { sizes: number[], note: string }>} */
const PROFILES = {
  35: { sizes: [35], note: 'small surface' },
  100: { sizes: [100], note: 'medium app' },
  300: { sizes: [300], note: 'large grid' },
};

module.exports = { TOOLBAR_ICONS, GRID_KINDS, HERO_ICONS, PROFILES };
