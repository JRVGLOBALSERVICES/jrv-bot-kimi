/**
 * Customer Flows - Handles structured customer interactions.
 *
 * Flows:
 * 1. New Customer Welcome → Collect name → Show available cars → Pricing → Book
 * 2. Returning Customer → Greet by name → Check active rental → Offer services
 * 3. Payment Collection → Show payment methods → Await proof → Forward to admin
 * 4. Document Collection → List required docs → Await submission
 * 5. Extension Request → Check current rental → Calculate rate → Confirm
 * 6. Return Process → Remind fuel/cleanliness → Confirm return location
 * 7. Expiry Contact → Auto-contact expiring customers → Extend or return?
 */

const policies = require('./policies');
const { formatMYT, daysBetween, todayMYT } = require('../utils/time');

class CustomerFlows {
  /**
   * Welcome flow for new customers.
   */
  newCustomerWelcome(name, language = 'en') {
    if (language === 'ms') {
      return `*Selamat datang ke JRV Car Rental!* 🚗\n\n` +
        `Saya JARVIS, pembantu AI kami.\n\n` +
        `\`\`\`\nBoleh saya tahu:\n1. Nama penuh anda?\n2. Tarikh sewa (bila → bila)?\n3. Jenis kereta yang diminati?\n\`\`\`\n\n` +
        `Atau taip "harga" untuk lihat senarai harga penuh.`;
    }
    return `*Welcome to JRV Car Rental!* 🚗\n\n` +
      `I'm JARVIS, the AI assistant.\n\n` +
      `\`\`\`\nMay I know:\n1. Your full name?\n2. Rental dates (from → to)?\n3. Preferred car type?\n\`\`\`\n\n` +
      `Or type "pricing" to see our full rate card.`;
  }

  /**
   * Returning customer greeting.
   */
  returningCustomerGreeting(name, activeRentals = [], totalRentals = 0, language = 'en') {
    const isRegular = totalRentals >= 5;
    const prefix = isRegular ? '⭐ ' : '';

    let text;
    if (language === 'ms') {
      text = `*${prefix}Hai ${name}!* Selamat kembali ke JRV! 👋\n`;
    } else {
      text = `*${prefix}Hi ${name}!* Welcome back to JRV! 👋\n`;
    }

    if (activeRentals.length > 0) {
      const rental = activeRentals[0];
      const daysLeft = daysBetween(todayMYT(), rental.end_date);

      text += `\n*Active Rental:*\n\`\`\`\n`;
      text += `Car: ${rental.car_description || rental.car_model || 'N/A'}\n`;
      text += `Until: ${rental.end_date}`;
      if (daysLeft <= 3) {
        text += ` (${daysLeft} days left!)`;
      }
      text += `\n\`\`\`\n`;
      text += `\nHow can I help you today?`;
    } else {
      text += `\nYou have ${totalRentals} total rental(s) with us.\n`;
      text += `Looking to rent again? I can show you what's available! 🚗`;
    }

    return text;
  }

  /**
   * Available cars for today (customer view - NO plates).
   */
  formatAvailableCarsForCustomer(validatedCars, language = 'en') {
    const available = validatedCars.filter(c =>
      (c._validatedStatus || c.status) === 'available'
    );

    if (available.length === 0) {
      return language === 'ms'
        ? '*Maaf*\n```Tiada kereta yang tersedia sekarang. Sila hubungi kami untuk tarikh lain.```'
        : '*Sorry*\n```No cars available right now. Contact us for alternative dates.```';
    }

    let text = language === 'ms'
      ? `*Kereta Tersedia (${available.length})*\n\n`
      : `*Available Cars (${available.length})*\n\n`;

    // Group by category
    const grouped = {};
    for (const car of available) {
      const cat = car.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(car);
    }

    for (const [cat, cars] of Object.entries(grouped)) {
      const pricing = policies.getCategoryPricing(cat);
      text += `*${cat.charAt(0).toUpperCase() + cat.slice(1)}*\n\`\`\`\n`;
      for (const car of cars) {
        // NO PLATES for customers - model and color only
        text += `${car.make} ${car.model}`;
        if (car.color) text += ` (${car.color})`;
        if (car.year) text += ` ${car.year}`;
        text += `\n`;
      }
      if (pricing) {
        text += `Rate: RM${pricing.daily}/day\n`;
      }
      text += `\`\`\`\n\n`;
    }

    text += `📞 WhatsApp: +${policies.admins.businessNumber}`;
    return text;
  }

  /**
   * Available cars for admin (WITH plates).
   */
  formatAvailableCarsForAdmin(validatedCars) {
    const available = validatedCars.filter(c =>
      (c._validatedStatus || c.status) === 'available'
    );

    if (available.length === 0) {
      return '*Available Cars*\n```None available```';
    }

    let text = `*Available Cars (${available.length})*\n\`\`\`\n`;
    for (const car of available) {
      text += `${car.car_plate} | ${car.make} ${car.model}`;
      if (car.color) text += ` (${car.color})`;
      text += ` | RM${car.daily_rate}/day\n`;
    }
    text += `\`\`\``;
    return text;
  }

  /**
   * Payment collection flow.
   */
  paymentInstructions(amount = null, language = 'en') {
    let text;
    if (language === 'ms') {
      text = `*Kaedah Pembayaran*\n`;
    } else {
      text = `*Payment Methods*\n`;
    }

    text += `\`\`\`\n`;
    text += `1. Tunai (semasa ambil kereta)\n`;
    text += `2. Bank Transfer:\n`;
    text += `   ${policies.payment.bank.name}\n`;
    text += `   Acc: ${policies.payment.bank.account}\n`;
    text += `   ${policies.payment.bank.holder}\n`;
    text += `3. QR Code\n`;
    text += `\`\`\`\n`;

    if (amount) {
      text += `\n*Amount: RM${amount}*\n`;
    }

    text += `\nSila hantar bukti pembayaran selepas transfer.`;
    return text;
  }

  /**
   * Document collection reminder.
   */
  documentReminder(isForeigner = false, language = 'en') {
    return policies.formatDocumentRequirements(isForeigner);
  }

  /**
   * Extension request flow.
   */
  extensionInfo(currentRental, extraDays = 1, language = 'en') {
    const cat = currentRental.category || 'economy';
    const pricing = policies.getCategoryPricing(cat);
    const dailyRate = pricing ? pricing.daily : (currentRental.daily_rate || 80);
    const extensionCost = dailyRate * extraDays;

    let text = `*Rental Extension*\n`;
    text += `\`\`\`\n`;
    text += `Current end: ${currentRental.end_date}\n`;
    text += `Extension: ${extraDays} day(s)\n`;
    text += `Rate: RM${dailyRate}/day\n`;
    text += `Additional cost: RM${extensionCost}\n`;
    text += `\`\`\`\n`;
    text += `\n${policies.extension.note}`;
    return text;
  }

  /**
   * Car return reminder.
   */
  returnReminder(agreement, language = 'en') {
    let text;
    if (language === 'ms') {
      text = `*Peringatan Pulang Kereta*\n`;
    } else {
      text = `*Car Return Reminder*\n`;
    }

    text += `\`\`\`\n`;
    text += `Return date: ${agreement.end_date}\n`;
    text += `\n`;
    text += `Checklist:\n`;
    text += `☐ Same fuel level as pickup\n`;
    text += `☐ Car is clean (inside & outside)\n`;
    text += `☐ No new damage\n`;
    text += `☐ All personal items removed\n`;
    text += `\`\`\`\n`;
    text += `\n*Fuel:* ${policies.fuel.note}\n`;
    text += `*Cleaning:* ${policies.cleanliness.note}`;
    return text;
  }

  /**
   * Expiring rental message (sent to customer proactively).
   */
  expiringRentalMessage(agreement, daysLeft, language = 'en') {
    let text;
    if (language === 'ms') {
      text = `*Sewa Anda Hampir Tamat*\n\n`;
      text += `Hai ${agreement.customer_name}!\n`;
      text += `\`\`\`\nKereta anda perlu dipulang dalam ${daysLeft} hari (${agreement.end_date}).\`\`\`\n\n`;
      text += `Adakah anda ingin:\n`;
      text += `1. Sambung sewa (extension)\n`;
      text += `2. Pulang kereta\n\n`;
      text += `Sila maklumkan. Terima kasih!`;
    } else {
      text = `*Your Rental is Expiring*\n\n`;
      text += `Hi ${agreement.customer_name}!\n`;
      text += `\`\`\`\nYour car is due back in ${daysLeft} day(s) (${agreement.end_date}).\`\`\`\n\n`;
      text += `Would you like to:\n`;
      text += `1. Extend your rental\n`;
      text += `2. Return the car\n\n`;
      text += `Please let us know. Thank you!`;
    }
    return text;
  }

  /**
   * Cancellation confirmation.
   */
  cancellationInfo(agreement, language = 'en') {
    const startDate = new Date(agreement.start_date);
    const now = new Date();
    const hoursUntilStart = (startDate - now) / (1000 * 60 * 60);

    let fee = 0;
    let feeNote = '';
    if (hoursUntilStart < 24 && hoursUntilStart > 0) {
      fee = 50;
      feeNote = 'Late cancellation fee: RM50';
    } else if (hoursUntilStart <= 0) {
      fee = policies.getCategoryPricing(agreement.category)?.daily || 80;
      feeNote = `No-show: Full day charge RM${fee}`;
    } else {
      feeNote = 'Free cancellation (more than 24h before pickup)';
    }

    let text = `*Cancellation*\n`;
    text += `\`\`\`\n`;
    text += `Booking: ${agreement.agreement_number || agreement.id}\n`;
    text += `${feeNote}\n`;
    text += `\`\`\`\n`;
    text += `\n${policies.cancellation.note}`;
    return text;
  }
}

module.exports = new CustomerFlows();
