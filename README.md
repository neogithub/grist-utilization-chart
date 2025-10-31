# Grist Utilization Chart

An interactive custom widget for [Grist](https://www.getgrist.com/) that visualizes team member utilization data with billable vs non-billable percentages, target tracking, and trend analysis.

## Features

### Visualization Modes
- **Bar Chart View**: Displays average utilization percentages per person with billable and non-billable breakdown
- **Trend Analysis View**: Shows utilization trends over time periods (quarters/years) with line charts

### Target Management
- Per-person per-year utilization targets
- Visual target lines overlaid on charts
- Interactive target history modal (click any bar or data point)
- Toggle target display on/off

### Advanced Filtering
- **Department Filtering**:
  - All Departments
  - 3D Department (filters for departments containing "3d")
  - Design Department (filters for departments containing "design")
  - Custom (select specific department from dropdown)
- **Time Period Filtering**:
  - Year selector
  - Quarter selector (Q1, Q2, Q3, Q4)
- **Individual Filtering**: Filter by specific team member name

### Debug Features
- Debug console toggle for troubleshooting
- Dump records button to inspect normalized data
- Dump targets button to view loaded target mappings
- Timestamped logging

## Prerequisites

This widget is designed to work within a Grist document and requires:
- A Grist document with appropriate table structure (see Data Structure below)
- Modern web browser with JavaScript enabled

## Installation

1. **Add to Grist**:
   - In your Grist document, add a new Custom Widget
   - Select "Custom URL"
   - Host these files on a web server accessible to your Grist instance
   - Enter the URL to your hosted `index.html`

2. **Local Development**:
   - Simply open `index.html` in a browser with a local server
   - Example: `python -m http.server 8000` then navigate to `http://localhost:8000`

## Data Structure

The widget expects two Grist tables:

### 1. People Table
**Table ID**: `People` (configurable in scripts.js:2)

Required columns:
- `id` (row ID, automatic)
- `Name` (text): Full name of team member

### 2. Utilization Data Table
The main table connected to the widget should contain:

Required columns:
- `Name` (text or reference): Team member name
- `Department` (text): Department name
- `Billable` (numeric): Billable utilization percentage (0-100)
- `Non_Billable` (numeric): Non-billable utilization percentage (0-100)
- `Year` (integer): Year (e.g., 2024, 2025)
- `Quarter` (text): Quarter designation (e.g., "Q1", "Q2", "Q3", "Q4")

Optional columns:
- `Period` (text): Alternative to Year/Quarter, formatted as "YYYY QX" (e.g., "2024 Q1")

### 3. Utilization Targets Table
**Table ID**: `Utilization_Targets` (configurable in scripts.js:3)

Required columns:
- `Person` (reference): Reference to People table
- `Year` (integer): Target year
- `Target` (numeric): Target utilization percentage (0-100)

## Configuration

Edit `scripts.js` lines 2-3 to match your Grist table IDs:

```javascript
const PEOPLE_TABLE_ID = 'People';               // Your People table ID
const UTIL_TARGETS_TABLE_ID = 'Utilization_Targets'; // Your Targets table ID
```

**Note**: Use the actual Grist Table ID, not the display name. To find your table ID:
1. Open your Grist document
2. Go to Raw Data view
3. The table ID is shown in the URL or table selector

## Usage

### Basic Operation

1. **View Selection**: Toggle between "Bar Chart" and "Trend Analysis" views using the top buttons

2. **Department Filtering**:
   - Select a radio button (All, 3D, Design, or Custom)
   - If Custom is selected, the Department dropdown becomes active

3. **Time Period Filtering**:
   - Select year to filter data to specific year
   - Select quarter to filter to specific quarter
   - Select "All" to show aggregated data

4. **Individual Analysis**:
   - Use Name filter to focus on specific team member
   - Click any bar (Bar Chart) or data point (Trend Chart) to view target history

5. **Target Display**:
   - Check/uncheck "Show Target" to toggle target lines
   - Targets only display when a specific year is selected

### Debug Mode

1. Check "Show Debug" to reveal debug controls
2. Click "Dump Records" to inspect first 10 normalized records
3. Click "Dump Targets" to view the complete target mapping
4. Debug output includes timestamps and JSON formatting

## Technical Details

### Dependencies
- **Grist Plugin API**: Widget communication with Grist
- **Chart.js 3.7.0**: Chart rendering
- **Lodash 4.17.21**: Data manipulation and grouping

### Data Normalization
The widget automatically normalizes incoming data:
- Extracts Year/Quarter from Period field if needed
- Reconstructs Period from Year/Quarter if missing
- Converts numeric fields to proper number types
- Trims and standardizes text fields

### Performance
- Lazy loading of target data on widget initialization
- Efficient data grouping using Lodash
- Chart instance recycling (destroys old chart before creating new)

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires ES6+ JavaScript support
- Canvas API required for Chart.js

## Files

- `index.html` - Main widget structure and layout
- `scripts.js` - Core logic, data processing, and chart generation
- `styles.css` - Visual styling and layout

## License

Internal use project.

## Version History

Current version includes:
- Department type filtering (All/3D/Design/Custom)
- Target history modal with click interaction
- Dual view modes (Bar/Trend)
- Debug console with record/target inspection
- Year/Quarter/Name filtering
- Per-person per-year target tracking
