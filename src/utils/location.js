/**
 * Location Service — Google Maps, reverse geocoding, delivery zone matching.
 *
 * Features:
 * 1. Generate Google Maps links from coordinates or place names
 * 2. Reverse geocode (lat/lng → address) using Nominatim (free, no key)
 * 3. Match coordinates to JRV delivery zones by distance
 * 4. Calculate delivery fees based on GPS location
 * 5. Parse WhatsApp location messages
 *
 * JRV base location: Seremban, Negeri Sembilan, Malaysia (2.7258, 101.9424)
 */

const policies = require('../brain/policies');

// JRV office coordinates (Seremban Gateway)
const JRV_BASE = { lat: 2.7256079, lng: 101.9289448, name: 'JRV Car Rental, Seremban Gateway' };

// Known delivery zone coordinates for distance-based matching
const ZONE_COORDS = {
  seremban:  { lat: 2.7258, lng: 101.9424, zone: 'free' },
  senawang:  { lat: 2.6839, lng: 101.9513, zone: 'free' },
  sendayan:  { lat: 2.6513, lng: 101.8832, zone: 'free' },
  nilai:     { lat: 2.8162, lng: 101.7967, zone: 'zone1' },
  portDickson: { lat: 2.5228, lng: 101.7966, zone: 'zone1' },
  klia:      { lat: 2.7456, lng: 101.7099, zone: 'zone2' },
  klia2:     { lat: 2.7406, lng: 101.6979, zone: 'zone2' },
  kl:        { lat: 3.1390, lng: 101.6869, zone: 'zone3' },
  melaka:    { lat: 2.1896, lng: 102.2501, zone: 'zone3' },
};

// Distance thresholds (km) for zone assignment when no exact match
const ZONE_THRESHOLDS = [
  { maxKm: 15, zone: 'free', label: 'Seremban area (FREE delivery)' },
  { maxKm: 40, zone: 'zone1', label: 'Nearby (RM50 delivery)' },
  { maxKm: 70, zone: 'zone2', label: 'Medium distance (RM70 delivery)' },
  { maxKm: 999, zone: 'zone3', label: 'Long distance (RM150 delivery)' },
];

class LocationService {
  /**
   * Generate a Google Maps link from coordinates.
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {string} label - Optional place label
   * @returns {string} Google Maps URL
   */
  mapsLink(lat, lng, label = '') {
    if (label) {
      return `https://maps.google.com/?q=${encodeURIComponent(label)}@${lat},${lng}`;
    }
    return `https://maps.google.com/?q=${lat},${lng}`;
  }

  /**
   * Generate a Google Maps directions link from customer location to JRV.
   * @param {number} lat - Customer latitude
   * @param {number} lng - Customer longitude
   * @returns {string} Google Maps directions URL
   */
  directionsToJrv(lat, lng) {
    return `https://maps.google.com/maps/dir/${lat},${lng}/${JRV_BASE.lat},${JRV_BASE.lng}`;
  }

  /**
   * Generate a Google Maps link for JRV office.
   * @returns {string} Google Maps URL for JRV
   */
  jrvLocation() {
    return this.mapsLink(JRV_BASE.lat, JRV_BASE.lng, JRV_BASE.name);
  }

  /**
   * Reverse geocode coordinates to an address using Nominatim (free).
   * @param {number} lat
   * @param {number} lng
   * @returns {{ address: string, area: string, state: string, country: string }}
   */
  async reverseGeocode(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'JRV-Bot/1.0 (car rental assistant)' },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error(`Nominatim error ${res.status}`);

      const data = await res.json();
      const addr = data.address || {};

      return {
        fullAddress: data.display_name || '',
        area: addr.suburb || addr.city_district || addr.town || addr.city || addr.county || '',
        city: addr.city || addr.town || addr.county || '',
        state: addr.state || '',
        country: addr.country || '',
        postcode: addr.postcode || '',
      };
    } catch (err) {
      console.warn('[Location] Reverse geocode failed:', err.message);
      return { fullAddress: '', area: '', city: '', state: '', country: '', postcode: '' };
    }
  }

  /**
   * Calculate distance between two points (Haversine formula).
   * @returns {number} Distance in kilometers
   */
  distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = this._toRad(lat2 - lat1);
    const dLng = this._toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(this._toRad(lat1)) * Math.cos(this._toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Calculate distance from customer to JRV office.
   * @param {number} lat
   * @param {number} lng
   * @returns {number} Distance in km
   */
  distanceToJrv(lat, lng) {
    return this.distanceKm(lat, lng, JRV_BASE.lat, JRV_BASE.lng);
  }

  /**
   * Match coordinates to a delivery zone.
   * First tries matching known zone coordinates, then falls back to distance.
   * @param {number} lat
   * @param {number} lng
   * @returns {{ zone: string, fee: number, label: string, distanceKm: number, nearestArea: string }}
   */
  matchDeliveryZone(lat, lng) {
    const distToBase = this.distanceToJrv(lat, lng);

    // Try matching to known zone coordinates
    let nearestZone = null;
    let nearestDist = Infinity;
    let nearestName = '';

    for (const [name, coords] of Object.entries(ZONE_COORDS)) {
      const dist = this.distanceKm(lat, lng, coords.lat, coords.lng);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestZone = coords.zone;
        nearestName = name;
      }
    }

    // If very close to a known zone (<10km), use that zone
    if (nearestDist < 10 && nearestZone) {
      const zoneData = policies.deliveryZones[nearestZone];
      return {
        zone: nearestZone,
        fee: zoneData?.fee ?? 150,
        label: zoneData?.label || 'Delivery',
        distanceKm: Math.round(distToBase),
        nearestArea: nearestName,
      };
    }

    // Fall back to distance-based thresholds
    for (const threshold of ZONE_THRESHOLDS) {
      if (distToBase <= threshold.maxKm) {
        const zoneData = policies.deliveryZones[threshold.zone];
        return {
          zone: threshold.zone,
          fee: zoneData?.fee ?? 150,
          label: threshold.label,
          distanceKm: Math.round(distToBase),
          nearestArea: nearestName,
        };
      }
    }

    // Fallback: zone3 (long distance)
    return {
      zone: 'zone3',
      fee: 150,
      label: 'Long distance (RM150 delivery)',
      distanceKm: Math.round(distToBase),
      nearestArea: nearestName,
    };
  }

  /**
   * Parse a WhatsApp location message into structured data.
   * @param {object} msg - Parsed WhatsApp message with location data
   * @returns {{ lat: number, lng: number, name: string, address: string, mapsLink: string }}
   */
  parseLocationMessage(msg) {
    // WhatsApp location messages have lat/lng in the body or location object
    let lat, lng, name, address;

    if (msg.location) {
      lat = msg.location.latitude;
      lng = msg.location.longitude;
      name = msg.location.description || msg.location.name || '';
      address = msg.location.address || '';
    } else if (msg.body) {
      // Try to extract coordinates from text
      const coordMatch = msg.body.match(/([-+]?\d+\.?\d*)\s*,\s*([-+]?\d+\.?\d*)/);
      if (coordMatch) {
        lat = parseFloat(coordMatch[1]);
        lng = parseFloat(coordMatch[2]);
      }
    }

    if (!lat || !lng) return null;

    return {
      lat,
      lng,
      name: name || '',
      address: address || '',
      mapsLink: this.mapsLink(lat, lng, name),
      directionsLink: this.directionsToJrv(lat, lng),
    };
  }

  /**
   * Format a full location response for WhatsApp.
   * Includes: address, zone, fee, distance, maps links.
   * @param {number} lat
   * @param {number} lng
   * @param {string} customerName
   * @param {boolean} isAdmin
   * @returns {string} Formatted WhatsApp message
   */
  async formatLocationResponse(lat, lng, customerName, isAdmin = false) {
    const [geo, zone] = await Promise.all([
      this.reverseGeocode(lat, lng),
      Promise.resolve(this.matchDeliveryZone(lat, lng)),
    ]);

    const parts = [];

    parts.push('*Location Received*');
    parts.push('```');

    if (geo.fullAddress) {
      parts.push(`Address: ${geo.fullAddress.slice(0, 120)}`);
    }
    if (geo.area) {
      parts.push(`Area: ${geo.area}`);
    }

    parts.push(`Distance to JRV: ${zone.distanceKm}km`);
    parts.push(`Delivery Zone: ${zone.label}`);
    parts.push(`Fee: ${zone.fee === 0 ? 'FREE' : 'RM' + zone.fee}`);
    parts.push('```');

    // Maps links
    parts.push('');
    parts.push(`View on Maps: ${this.mapsLink(lat, lng)}`);
    parts.push(`Directions to JRV: ${this.directionsToJrv(lat, lng)}`);

    if (isAdmin) {
      parts.push('');
      parts.push(`_GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}_`);
      if (zone.nearestArea) {
        parts.push(`_Nearest zone: ${zone.nearestArea}_`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Format a location notification for admin.
   */
  formatLocationNotification(phone, name, lat, lng, zone, geo) {
    return `*Location Shared*\n` +
      '```\n' +
      `From: ${name} (+${phone})\n` +
      `Area: ${geo?.area || 'Unknown'}\n` +
      `Distance: ${zone.distanceKm}km from JRV\n` +
      `Zone: ${zone.label}\n` +
      `Fee: ${zone.fee === 0 ? 'FREE' : 'RM' + zone.fee}\n` +
      '```\n' +
      `Maps: ${this.mapsLink(lat, lng)}`;
  }

  // Internal helper
  _toRad(deg) {
    return deg * (Math.PI / 180);
  }
}

module.exports = new LocationService();
