/**
 * Booking Creation Flow - Guided booking through JARVIS chat.
 *
 * Flow:
 * 1. Customer asks to book → Show available cars (no plates for customers)
 * 2. Customer picks car → Confirm car + show pricing
 * 3. Customer provides dates → Calculate total
 * 4. Collect name + phone
 * 5. Delivery/pickup option → pickup at office or delivery to location
 * 6. Final confirmation → Assign plate internally
 * 7. Confirm booking → Notify Vir with plate + details, customer sees NO plate
 * 8. Show payment instructions + document requirements
 *
 * Plate assignment: car plate is assigned internally and sent to Vir.
 * Customer only learns the plate on pickup/delivery day.
 *
 * State machine per conversation, stored in conversation context.
 */

const policies = require('./policies');
const notifications = require('./notifications');
const customerFlows = require('./customer-flows');
const { syncEngine, agreementsService, fleetService } = require('../supabase/services');
const { validateFleetStatus, colorName } = require('../utils/validators');
const { daysBetween, todayMYT } = require('../utils/time');

const BOOKING_STATES = {
  IDLE: 'idle',
  SELECTING_CAR: 'selecting_car',
  SELECTING_DATES: 'selecting_dates',
  COLLECTING_INFO: 'collecting_info',
  DELIVERY_OPTION: 'delivery_option',
  CONFIRMING: 'confirming',
  PAYMENT: 'payment',
  COMPLETED: 'completed',
};

class BookingFlow {
  constructor() {
    // Active booking sessions: phone → bookingData
    this.sessions = new Map();
  }

  /**
   * Check if phone has an active booking flow.
   */
  isActive(phone) {
    const session = this.sessions.get(phone);
    return session && session.state !== BOOKING_STATES.IDLE && session.state !== BOOKING_STATES.COMPLETED;
  }

  /**
   * Start a new booking flow.
   */
  async start(phone, name, isAdmin = false) {
    this.sessions.set(phone, {
      state: BOOKING_STATES.SELECTING_CAR,
      phone,
      name,
      isAdmin,
      selectedCar: null,
      startDate: null,
      endDate: null,
      customerName: name,
      customerPhone: phone,
      totalAmount: null,
      deliveryOption: null, // 'pickup' or 'delivery'
      deliveryLocation: null,
      assignedPlate: null,
      createdAt: new Date(),
    });

    // Fetch fresh data (don't rely on cache which may be empty if sync failed)
    const [allCars, activeAgreements] = await Promise.all([
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
    ]);
    const { validated } = validateFleetStatus(allCars, activeAgreements);
    const available = validated.filter(c => (c._validatedStatus || c.status) === 'available');

    if (available.length === 0) {
      this.sessions.delete(phone);
      return '*Sorry*\n```No cars available right now. Please contact us at +60126565477.```';
    }

    let text = `*Let's book a car!*\n\nHere's what's available:\n\n`;

    // Number each car for selection
    available.forEach((car, i) => {
      const cat = car.body_type || 'economy';
      const pricing = policies.getCategoryPricing(cat);
      const rate = pricing ? pricing.daily : car.daily_price || 80;

      if (isAdmin) {
        text += `*${i + 1}.* ${car.plate_number} - ${car._carName || car.body_type || ''}`;
      } else {
        text += `*${i + 1}.* ${car._carName || car.body_type || ''}`;
      }
      if (car.color) text += ` (${colorName(car.color)})`;
      text += ` — RM${rate}/day\n`;
    });

    text += `\nReply with the *number* to select a car.`;
    text += `\nOr type "cancel" to cancel booking.`;

    // Store available cars for reference
    this.sessions.get(phone)._availableCars = available;

    return text;
  }

  /**
   * Process a message within the booking flow.
   */
  process(phone, text, name) {
    const session = this.sessions.get(phone);
    if (!session) return null;

    const lower = text.toLowerCase().trim();

    // Cancel at any point
    if (lower === 'cancel' || lower === 'batal' || lower === 'no' || lower === 'tak jadi') {
      this.sessions.delete(phone);
      return '*Booking Cancelled*\n```No worries! Let us know if you change your mind.```';
    }

    switch (session.state) {
      case BOOKING_STATES.SELECTING_CAR:
        return this._handleCarSelection(session, text);

      case BOOKING_STATES.SELECTING_DATES:
        return this._handleDateSelection(session, text);

      case BOOKING_STATES.COLLECTING_INFO:
        return this._handleInfoCollection(session, text);

      case BOOKING_STATES.DELIVERY_OPTION:
        return this._handleDeliveryOption(session, text);

      case BOOKING_STATES.CONFIRMING:
        return this._handleConfirmation(session, text);

      case BOOKING_STATES.PAYMENT:
        return this._handlePayment(session, text);

      default:
        return null;
    }
  }

  // ─── State Handlers ────────────────────────────────────

  _handleCarSelection(session, text) {
    const num = parseInt(text.trim());
    const cars = session._availableCars;

    if (isNaN(num) || num < 1 || num > cars.length) {
      return `Please reply with a number between 1 and ${cars.length}.\nOr type "cancel" to stop.`;
    }

    const car = cars[num - 1];
    session.selectedCar = car;
    session.state = BOOKING_STATES.SELECTING_DATES;

    const cat = car.body_type || 'economy';
    const pricing = policies.getCategoryPricing(cat);

    let text2 = `*Selected: ${car._carName || car.body_type || ''}*\n`;
    if (pricing) {
      text2 += `\`\`\`\n`;
      text2 += `Daily:   RM${pricing.daily}\n`;
      text2 += `3-Day:   RM${pricing.threeDays}\n`;
      text2 += `Weekly:  RM${pricing.weekly}\n`;
      text2 += `Monthly: RM${pricing.monthly}\n`;
      text2 += `\`\`\`\n`;
    }
    text2 += `\nPlease provide your rental dates:\n`;
    text2 += `Format: \`start date - end date\`\n`;
    text2 += `Example: \`2026-02-20 - 2026-02-25\`\n`;
    text2 += `Or: \`tomorrow - 5 days\``;

    return text2;
  }

  _handleDateSelection(session, text) {
    const dates = this._parseDates(text);

    if (!dates) {
      return `*Could not parse dates*\n\`\`\`\nPlease use format:\n2026-02-20 - 2026-02-25\nor: tomorrow - 3 days\nor: today - next week\n\`\`\``;
    }

    session.startDate = dates.start;
    session.endDate = dates.end;

    const days = daysBetween(dates.start, dates.end);
    if (days <= 0) {
      return `End date must be after start date. Please try again.`;
    }

    const cat = session.selectedCar.body_type || 'economy';
    const pricing = policies.getCategoryPricing(cat);
    const dailyRate = pricing ? pricing.daily : session.selectedCar.daily_price || 80;

    // Calculate best rate
    let total;
    if (days >= 30 && pricing) {
      const months = Math.floor(days / 30);
      const remainDays = days % 30;
      total = months * pricing.monthly + remainDays * dailyRate;
    } else if (days >= 7 && pricing) {
      const weeks = Math.floor(days / 7);
      const remainDays = days % 7;
      total = weeks * pricing.weekly + remainDays * dailyRate;
    } else if (days >= 3 && pricing) {
      const sets = Math.floor(days / 3);
      const remainDays = days % 3;
      total = sets * pricing.threeDays + remainDays * dailyRate;
    } else {
      total = days * dailyRate;
    }

    session.totalAmount = total;
    session.state = BOOKING_STATES.COLLECTING_INFO;

    let response = `*Booking Summary*\n\`\`\`\n`;
    response += `Car: ${session.selectedCar._carName || session.selectedCar.body_type || ''}\n`;
    response += `From: ${dates.start}\n`;
    response += `To:   ${dates.end}\n`;
    response += `Days: ${days}\n`;
    response += `Total: RM${total}\n`;
    response += `\`\`\`\n\n`;
    response += `Please confirm your details:\n`;
    response += `*Name:* ${session.customerName || '(please provide)'}\n\n`;
    response += `Is this correct? Reply *"yes"* to confirm or provide your full name.`;

    return response;
  }

  _handleInfoCollection(session, text) {
    const lower = text.toLowerCase().trim();

    if (lower === 'yes' || lower === 'ya' || lower === 'confirm' || lower === 'ok') {
      session.state = BOOKING_STATES.DELIVERY_OPTION;
      return this._showDeliveryOptions(session);
    }

    // Assume they're providing their name
    session.customerName = text.trim();
    session.state = BOOKING_STATES.DELIVERY_OPTION;
    return this._showDeliveryOptions(session);
  }

  _showDeliveryOptions(session) {
    let text = `*How would you like to get the car?*\n\n`;
    text += `*1.* Pickup from our office (FREE)\n`;
    text += `    📍 Seremban Gateway\n`;
    text += `*2.* Delivery to your location\n`;
    text += `    (Delivery fee depends on distance)\n`;
    text += `\nReply *1* or *2*.`;
    return text;
  }

  _handleDeliveryOption(session, text) {
    const lower = text.toLowerCase().trim();

    if (lower === '1' || /pickup|ambil|self.?collect|office/i.test(lower)) {
      session.deliveryOption = 'pickup';
      session.deliveryLocation = 'JRV Office, Seremban Gateway';
      session.state = BOOKING_STATES.CONFIRMING;
      return this._showFinalConfirmation(session);
    }

    if (lower === '2' || /deliver|hantar|send|location/i.test(lower)) {
      session.deliveryOption = 'delivery';
      session.state = BOOKING_STATES.CONFIRMING;

      let response = `*Delivery selected*\n\n`;
      response += `Please share your delivery location:\n`;
      response += `- Send a *location pin* 📍\n`;
      response += `- Or type the address/area name\n\n`;
      response += `_Delivery fees:_\n\`\`\`\n`;
      for (const zone of Object.values(policies.deliveryZones || {})) {
        response += `${zone.areas?.join('/') || zone.name}: ${zone.fee === 0 ? 'FREE' : 'RM' + zone.fee}\n`;
      }
      response += `\`\`\`\n`;
      response += `\nOr reply *"skip"* to confirm delivery details later.`;
      return response;
    }

    // If they typed an address/location directly (not 1 or 2), treat as delivery location
    if (lower !== 'skip') {
      session.deliveryOption = 'delivery';
      session.deliveryLocation = text.trim();
      session.state = BOOKING_STATES.CONFIRMING;
      return this._showFinalConfirmation(session);
    }

    // Skip — proceed without delivery location
    session.deliveryOption = 'delivery';
    session.deliveryLocation = 'TBD';
    session.state = BOOKING_STATES.CONFIRMING;
    return this._showFinalConfirmation(session);
  }

  _showFinalConfirmation(session) {
    const carName = session.selectedCar._carName || session.selectedCar.body_type || '';
    const deliveryLabel = session.deliveryOption === 'pickup'
      ? 'Pickup: Seremban Gateway (FREE)'
      : `Delivery: ${session.deliveryLocation || 'TBD'}`;

    let text = `*Final Confirmation*\n\`\`\`\n`;
    text += `Customer: ${session.customerName}\n`;
    text += `Phone: +${session.phone}\n`;
    text += `Car: ${carName}\n`;
    text += `Period: ${session.startDate} → ${session.endDate}\n`;
    text += `${deliveryLabel}\n`;
    text += `Total: RM${session.totalAmount}\n`;
    text += `\`\`\`\n\n`;
    text += `Reply *"confirm"* to proceed to payment.\n`;
    text += `Reply *"cancel"* to cancel.`;
    return text;
  }

  _handleConfirmation(session, text) {
    const lower = text.toLowerCase().trim();

    // If in delivery state and they provide a location before confirming
    if (session.deliveryOption === 'delivery' && !session.deliveryLocation && lower !== 'confirm' && lower !== 'yes' && lower !== 'ya' && lower !== 'ok' && lower !== 'proceed' && lower !== 'skip') {
      session.deliveryLocation = text.trim();
      return this._showFinalConfirmation(session);
    }

    if (lower === 'skip' && session.deliveryOption === 'delivery' && !session.deliveryLocation) {
      session.deliveryLocation = 'TBD';
      return this._showFinalConfirmation(session);
    }

    if (lower === 'confirm' || lower === 'yes' || lower === 'ya' || lower === 'ok' || lower === 'proceed') {
      session.state = BOOKING_STATES.PAYMENT;

      // Internally assign the plate number
      const assignedPlate = session.selectedCar.plate_number;
      session.assignedPlate = assignedPlate;
      const carName = session.selectedCar._carName || session.selectedCar.body_type || '';
      const deliveryLabel = session.deliveryOption === 'pickup'
        ? 'Pickup at Seremban Gateway'
        : `Delivery to ${session.deliveryLocation || 'TBD'}`;

      // Notify Vir with FULL details including assigned plate
      const bookingData = {
        customer_name: session.customerName,
        mobile: session.phone,
        plate_number: assignedPlate,
        car_type: carName,
        date_start: session.startDate,
        date_end: session.endDate,
        total_price: session.totalAmount,
        delivery: deliveryLabel,
      };
      notifications.onNewBooking(bookingData).catch(() => {});

      // Customer response — NO plate number, car details shared on pickup/delivery
      let response = `*Booking Confirmed!*\n\`\`\`\n`;
      response += `Car: ${carName}\n`;
      response += `Period: ${session.startDate} → ${session.endDate}\n`;
      response += `${deliveryLabel}\n`;
      response += `Total: RM${session.totalAmount}\n`;
      response += `\`\`\`\n\n`;
      response += `*Vehicle details (plate number) will be shared on ${session.deliveryOption === 'pickup' ? 'pickup' : 'delivery'} day.*\n\n`;
      response += customerFlows.paymentInstructions(session.totalAmount);
      response += `\n\n*Required documents:*\n`;
      response += `1. IC / Passport\n2. Driving License\n3. Utility Bill\n\n`;
      response += `Our team will confirm your booking shortly!`;

      // Mark completed
      session.state = BOOKING_STATES.COMPLETED;

      return response;
    }

    return `Reply *"confirm"* to proceed or *"cancel"* to cancel.`;
  }

  _handlePayment(session, text) {
    // If they send payment confirmation
    session.state = BOOKING_STATES.COMPLETED;
    this.sessions.delete(session.phone);
    return `*Thank you!*\n\`\`\`Payment will be verified by our team.\`\`\`\n\nYou'll receive confirmation once verified.`;
  }

  // ─── Date Parsing ──────────────────────────────────────

  _parseDates(text) {
    const today = todayMYT();
    const now = new Date();

    // "2026-02-20 - 2026-02-25" or "20/02/2026 - 25/02/2026"
    const rangeMatch = text.match(/(\d{4}-\d{2}-\d{2})\s*[-–to]+\s*(\d{4}-\d{2}-\d{2})/);
    if (rangeMatch) {
      return { start: rangeMatch[1], end: rangeMatch[2] };
    }

    // "dd/mm/yyyy - dd/mm/yyyy"
    const slashMatch = text.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})\s*[-–to]+\s*(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
    if (slashMatch) {
      const start = `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`;
      const end = `${slashMatch[6]}-${slashMatch[5].padStart(2, '0')}-${slashMatch[4].padStart(2, '0')}`;
      return { start, end };
    }

    // "tomorrow - X days" or "today - X days"
    const relativeDays = text.match(/(?:tomorrow|today|esok|hari ini)\s*[-–to]+\s*(\d+)\s*(?:days?|hari)/i);
    if (relativeDays) {
      const startOffset = /tomorrow|esok/i.test(text) ? 1 : 0;
      const days = parseInt(relativeDays[1]);
      const start = new Date(now);
      start.setDate(start.getDate() + startOffset);
      const end = new Date(start);
      end.setDate(end.getDate() + days);

      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    }

    // "X days" (assume starting today)
    const justDays = text.match(/(\d+)\s*(?:days?|hari|malam)/i);
    if (justDays) {
      const days = parseInt(justDays[1]);
      const start = new Date(now);
      const end = new Date(now);
      end.setDate(end.getDate() + days);
      return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    }

    return null;
  }

  /**
   * Cancel booking for a phone.
   */
  cancel(phone) {
    this.sessions.delete(phone);
  }

  /**
   * Get active sessions count.
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      phones: [...this.sessions.keys()],
    };
  }
}

module.exports = new BookingFlow();
