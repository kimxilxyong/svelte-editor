/**
 * @fileoverview Registry mapping the generic widget kinds to their Flowbite-based components.
 *
 * `BlockContent.svelte` renders every kind listed here through one generic branch, passing the
 * superset of props described by `WidgetProps`. Widgets stay self-contained (they import only
 * `flowbite-svelte`) so they can be exported to a project one file at a time.
 */
import type { Component } from 'svelte';
import type { WidgetProps } from '../../widget-props.js';
import WidgetSearch from './WidgetSearch.svelte';
import WidgetFileUpload from './WidgetFileUpload.svelte';
import WidgetDropzone from './WidgetDropzone.svelte';
import WidgetMultiSelect from './WidgetMultiSelect.svelte';
import WidgetFloatingInput from './WidgetFloatingInput.svelte';
import WidgetDatepicker from './WidgetDatepicker.svelte';
import WidgetTimepicker from './WidgetTimepicker.svelte';
import WidgetPhoneInput from './WidgetPhoneInput.svelte';
import WidgetTags from './WidgetTags.svelte';
import WidgetButtonGroup from './WidgetButtonGroup.svelte';
import WidgetGradientButton from './WidgetGradientButton.svelte';
import WidgetRating from './WidgetRating.svelte';
import WidgetClipboard from './WidgetClipboard.svelte';
import WidgetHeading from './WidgetHeading.svelte';
import WidgetParagraph from './WidgetParagraph.svelte';
import WidgetBlockquote from './WidgetBlockquote.svelte';
import WidgetDivider from './WidgetDivider.svelte';
import WidgetList from './WidgetList.svelte';
import WidgetKbd from './WidgetKbd.svelte';
import WidgetImage from './WidgetImage.svelte';
import WidgetVideo from './WidgetVideo.svelte';
import WidgetSpinner from './WidgetSpinner.svelte';
import WidgetIndicator from './WidgetIndicator.svelte';
import WidgetSkeleton from './WidgetSkeleton.svelte';
import WidgetListGroup from './WidgetListGroup.svelte';
import WidgetAccordion from './WidgetAccordion.svelte';
import WidgetTabs from './WidgetTabs.svelte';
import WidgetTable from './WidgetTable.svelte';
import WidgetTimeline from './WidgetTimeline.svelte';
import WidgetStepper from './WidgetStepper.svelte';
import WidgetRadialProgress from './WidgetRadialProgress.svelte';
import WidgetPagination from './WidgetPagination.svelte';
import WidgetToast from './WidgetToast.svelte';
import WidgetBanner from './WidgetBanner.svelte';
import WidgetTooltip from './WidgetTooltip.svelte';
import WidgetPopover from './WidgetPopover.svelte';
import WidgetBreadcrumb from './WidgetBreadcrumb.svelte';
import WidgetNavbar from './WidgetNavbar.svelte';
import WidgetFooter from './WidgetFooter.svelte';
import WidgetSidebar from './WidgetSidebar.svelte';
import WidgetDropdown from './WidgetDropdown.svelte';
import WidgetModal from './WidgetModal.svelte';
import WidgetDrawer from './WidgetDrawer.svelte';
import WidgetDialog from './WidgetDialog.svelte';

/** Component per generic widget kind (a kind absent here has a dedicated branch in `BlockContent`). */
export const genericWidgets: Record<string, Component<Partial<WidgetProps>>> = {
	'widget-search': WidgetSearch as Component<Partial<WidgetProps>>,
	'widget-file-upload': WidgetFileUpload as Component<Partial<WidgetProps>>,
	'widget-dropzone': WidgetDropzone as Component<Partial<WidgetProps>>,
	'widget-multi-select': WidgetMultiSelect as Component<Partial<WidgetProps>>,
	'widget-floating-input': WidgetFloatingInput as Component<Partial<WidgetProps>>,
	'widget-datepicker': WidgetDatepicker as Component<Partial<WidgetProps>>,
	'widget-timepicker': WidgetTimepicker as Component<Partial<WidgetProps>>,
	'widget-phone-input': WidgetPhoneInput as Component<Partial<WidgetProps>>,
	'widget-tags': WidgetTags as Component<Partial<WidgetProps>>,
	'widget-button-group': WidgetButtonGroup as Component<Partial<WidgetProps>>,
	'widget-gradient-button': WidgetGradientButton as Component<Partial<WidgetProps>>,
	'widget-rating': WidgetRating as Component<Partial<WidgetProps>>,
	'widget-clipboard': WidgetClipboard as Component<Partial<WidgetProps>>,
	'widget-heading': WidgetHeading as Component<Partial<WidgetProps>>,
	'widget-paragraph': WidgetParagraph as Component<Partial<WidgetProps>>,
	'widget-blockquote': WidgetBlockquote as Component<Partial<WidgetProps>>,
	'widget-divider': WidgetDivider as Component<Partial<WidgetProps>>,
	'widget-list': WidgetList as Component<Partial<WidgetProps>>,
	'widget-kbd': WidgetKbd as Component<Partial<WidgetProps>>,
	'widget-image': WidgetImage as Component<Partial<WidgetProps>>,
	'widget-video': WidgetVideo as Component<Partial<WidgetProps>>,
	'widget-spinner': WidgetSpinner as Component<Partial<WidgetProps>>,
	'widget-indicator': WidgetIndicator as Component<Partial<WidgetProps>>,
	'widget-skeleton': WidgetSkeleton as Component<Partial<WidgetProps>>,
	'widget-list-group': WidgetListGroup as Component<Partial<WidgetProps>>,
	'widget-accordion': WidgetAccordion as Component<Partial<WidgetProps>>,
	'widget-tabs': WidgetTabs as Component<Partial<WidgetProps>>,
	'widget-table': WidgetTable as Component<Partial<WidgetProps>>,
	'widget-timeline': WidgetTimeline as Component<Partial<WidgetProps>>,
	'widget-stepper': WidgetStepper as Component<Partial<WidgetProps>>,
	'widget-radial-progress': WidgetRadialProgress as Component<Partial<WidgetProps>>,
	'widget-pagination': WidgetPagination as Component<Partial<WidgetProps>>,
	'widget-toast': WidgetToast as Component<Partial<WidgetProps>>,
	'widget-banner': WidgetBanner as Component<Partial<WidgetProps>>,
	'widget-tooltip': WidgetTooltip as Component<Partial<WidgetProps>>,
	'widget-popover': WidgetPopover as Component<Partial<WidgetProps>>,
	'widget-breadcrumb': WidgetBreadcrumb as Component<Partial<WidgetProps>>,
	'widget-navbar': WidgetNavbar as Component<Partial<WidgetProps>>,
	'widget-footer': WidgetFooter as Component<Partial<WidgetProps>>,
	'widget-sidebar': WidgetSidebar as Component<Partial<WidgetProps>>,
	'widget-dropdown': WidgetDropdown as Component<Partial<WidgetProps>>,
	'widget-modal': WidgetModal as Component<Partial<WidgetProps>>,
	'widget-drawer': WidgetDrawer as Component<Partial<WidgetProps>>,
	'widget-dialog': WidgetDialog as Component<Partial<WidgetProps>>
};
