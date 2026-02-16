/**
 * Kimi K2 Tool Definitions - Function calling tools for JARVIS.
 *
 * These tools let Kimi K2 query live data from Supabase
 * during conversation, so it can give accurate answers.
 */

const { fleetService, agreementsService, dataStoreService, syncEngine } = require('../supabase/services');
const policies = require('../brain/policies');
const { todayMYT, daysBetween } = require('../utils/time');
const { colorName } = require('../utils/validators');

// ─── Tool Definitions (OpenAI function format) ──────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_available_cars',
      description: 'Get list of currently available cars for rental. Returns car models, categories, and daily rates. Do NOT include car plates when responding to customers.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter by category: economy, compact, suv, premium, mpv. Leave empty for all.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pricing',
      description: 'Get rental pricing for all car categories. Returns daily, 3-day, weekly, and monthly rates.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_delivery_fee',
      description: 'Get delivery fee for a specific location.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Delivery location name (e.g., KLIA, KL, Seremban, Nilai)' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_customer',
      description: 'Look up a customer by phone number. Returns their rental history and active bookings.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Customer phone number' },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_bookings',
      description: 'Get all currently active rental bookings.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_expiring_rentals',
      description: 'Get rentals expiring within N days.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days ahead to check (default 3)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_overdue_rentals',
      description: 'Get all overdue rentals (past end date but not returned).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fleet_status',
      description: 'Get fleet overview: total cars, available, rented, maintenance counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_cars',
      description: 'Search for cars by make, model, color, or plate number.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_info',
      description: 'Get payment methods, bank details, and instructions.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_delivery_by_coordinates',
      description: 'Calculate delivery fee from GPS coordinates. Use when customer shares location.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitude' },
          longitude: { type: 'number', description: 'Longitude' },
        },
        required: ['latitude', 'longitude'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_jrv_location',
      description: 'Get JRV Car Rental office location (Google Maps link).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_policies',
      description: 'Get specific business policy information.',
      parameters: {
        type: 'object',
        properties: {
          policy: {
            type: 'string',
            description: 'Policy type: deposit, cancellation, extension, fuel, cleanliness, insurance, documents',
          },
        },
        required: ['policy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_team_member',
      description: 'Look up a JRV team member/admin by name or phone. Also use this when someone asks "who am I?" to look them up. Returns their role, relationship, and contact.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name or phone number to search. Use "all" to list all team members. Use "me" or the caller\'s name to identify the current speaker.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_stats',
      description: 'Get bot system info: current AI model, provider, API stats, uptime, performance. Use when asked about model, engine, speed, stats, or system.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reports',
      description: 'Generate daily business reports with LIVE data. Reports: 1=Expiring by Models, 2=Expiring with Contacts, 3=Expiring by Time Slot, 4=Follow-up Required, 5=Available Cars, 6=Summary/Totals, fleet=Fleet Status, earnings=Revenue. Use "all" or "1,2,3,4,5,6" for all 6 daily reports. Output is WhatsApp-formatted — SEND DIRECTLY as-is, do NOT reformat, summarize, or describe it.',
      parameters: {
        type: 'object',
        properties: {
          reports: {
            type: 'string',
            description: 'Comma-separated report numbers or names. Examples: "all", "1,2,3,4,5,6", "6", "fleet,earnings", "4,5"',
          },
        },
        required: ['reports'],
      },
    },
  },

  // ─── Web Search & URL Fetch (internet access) ──────

  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the internet for current information. Use when asked about something outside JRV business data — news, weather, general knowledge, prices, competitors, regulations, etc. Also useful for admin research tasks.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Be specific for better results.' },
          max_results: { type: 'number', description: 'Max results to return (1-10). Default: 5' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch and read the text content of a URL/webpage. Use when you need to read a specific page — articles, documentation, pricing pages, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch (must start with http:// or https://)' },
          max_length: { type: 'number', description: 'Max characters to return. Default: 5000' },
        },
        required: ['url'],
      },
    },
  },

  // ─── Data Store Query Tool (admin can read actual DB data) ──────

  {
    type: 'function',
    function: {
      name: 'query_data_store',
      description: 'Query bot_data_store database directly. Use this to read actual stored data — keys, templates, formats, configs. ALWAYS use this tool when asked about data store contents. NEVER guess or fabricate what is stored.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Action: "list_keys" (list all keys), "get" (read specific key), "search" (search by prefix)',
          },
          key: {
            type: 'string',
            description: 'For "get": exact key name. For "search": key prefix to match (e.g., "jarvis_report_format", "car_prices:").',
          },
        },
        required: ['action'],
      },
    },
  },

  // ─── Memory & Rules Tools (boss can teach JARVIS via chat) ──────

  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save something to JARVIS memory. Use when boss says "remember this", "note that", "keep in mind", or tells you a fact/preference/instruction to remember. Memory persists across conversations.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What to remember. Be precise and clear.' },
          type: { type: 'string', description: 'Memory type: fact (business facts), pref (preferences), note (contextual notes), skill (how-to instructions). Default: fact' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for easy searching. E.g., ["pricing", "airport"] or ["customer", "ali"]',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: 'Search JARVIS memory for something specific. Use when boss asks "do you remember...", "what did I tell you about...", or when you need to recall stored information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — matches against content, tags, and type' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_memories',
      description: 'List all stored memories or filter by type. Use when boss asks "what do you remember?" or "show memories".',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Filter by type: fact, pref, note, skill. Leave empty for all.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Delete/forget a memory by ID. Use when boss says "forget that", "delete memory", "remove that note".',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID to delete' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_rule',
      description: 'Add a new dynamic rule for JARVIS to follow. Use when boss says "new rule:", "from now on:", "always do X", "never do Y". Rules persist and are followed in all future conversations.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The rule text. Be specific and actionable.' },
          type: { type: 'string', description: 'Rule type: always (always do), never (never do), when (conditional), override (replaces hardcoded policy). Default: always' },
          priority: { type: 'string', description: 'Priority: high (critical rules) or normal. Default: normal' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_rule',
      description: 'Update an existing rule by ID. Use when boss wants to change a rule.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Rule ID to update' },
          content: { type: 'string', description: 'New rule text' },
        },
        required: ['id', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_rules',
      description: 'List all active dynamic rules. Use when boss asks "what are the rules?", "show rules", "what rules do you follow?".',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Filter by type: always, never, when, override. Leave empty for all.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_rule',
      description: 'Delete a rule by ID. Use when boss says "remove rule", "delete rule #X".',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Rule ID to delete' },
        },
        required: ['id'],
      },
    },
  },

  // ─── Skill Scripts (teachable procedures) ──────────────

  {
    type: 'function',
    function: {
      name: 'save_skill',
      description: 'Teach JARVIS a multi-step procedure. Use when boss says "learn how to...", "when X happens, do Y", or teaches a workflow. Unlike memories (facts), skills are executable step-by-step procedures.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name (e.g., "accident_report", "vip_greeting")' },
          trigger: { type: 'string', description: 'When to use this skill (e.g., "When customer reports accident")' },
          steps: { type: 'array', items: { type: 'string' }, description: 'Ordered steps to follow' },
          context: { type: 'string', description: 'Additional context about when/how to use this skill' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for searching' },
        },
        required: ['name', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_skill',
      description: 'Search for a learned skill/procedure. Use when you need to know how to handle a situation.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What situation or skill to search for' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List all learned skills/procedures.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_skill',
      description: 'Delete a learned skill by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID to delete' },
        },
        required: ['id'],
      },
    },
  },

  // ─── Knowledge Base (structured FAQ/docs) ──────────────

  {
    type: 'function',
    function: {
      name: 'kb_upsert',
      description: 'Add or update a knowledge base article. Use when boss says "add to KB", "update FAQ", or teaches a Q&A pair. Articles are auto-referenced when customers ask questions.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Article topic/title (e.g., "insurance", "airport_pickup")' },
          question: { type: 'string', description: 'Common question this answers (e.g., "Is insurance included?")' },
          answer: { type: 'string', description: 'The answer/content' },
          category: { type: 'string', description: 'Category: general, pricing, policy, faq, procedure, location. Default: general' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Search tags' },
        },
        required: ['topic', 'answer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_search',
      description: 'Search the knowledge base for relevant articles. Use BEFORE answering customer questions to check if there is a KB article with the right answer.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          category: { type: 'string', description: 'Filter by category (optional)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_list',
      description: 'List all knowledge base articles, optionally filtered by category.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_delete',
      description: 'Delete a knowledge base article by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Article ID to delete' },
        },
        required: ['id'],
      },
    },
  },

  // ─── Customer Profiles ────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'get_customer_profile',
      description: 'Get the full profile of a customer — preferences, booking history, admin notes, tags. Use when you need context about a specific customer beyond just their current rental.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Customer phone number' },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_customer_note',
      description: 'Add a note to a customer profile. Use when admin says "note about customer X: ...", "mark customer X as VIP", etc.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Customer phone number' },
          note: { type: 'string', description: 'The note to add' },
        },
        required: ['phone', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tag_customer',
      description: 'Add or remove a tag/label on a customer (VIP, student, corporate, blacklisted, etc.).',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Customer phone number' },
          tag: { type: 'string', description: 'Tag to add (e.g., "VIP", "student", "corporate")' },
          action: { type: 'string', description: '"add" or "remove". Default: add' },
        },
        required: ['phone', 'tag'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_customers',
      description: 'Search customer profiles by name, phone, or tag.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, phone number, or tag to search' },
        },
        required: ['query'],
      },
    },
  },

  // ─── Document Generator ───────────────────────────────

  {
    type: 'function',
    function: {
      name: 'create_document',
      description: 'Generate a formatted business document (WhatsApp-ready text). Types: invoice, receipt, quotation, agreement, payment_reminder, notice, custom. Use when asked to create invoices, receipts, quotations, or any business document.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Document type: invoice, receipt, quotation, agreement, payment_reminder, notice, custom' },
          customerName: { type: 'string', description: 'Customer name' },
          phone: { type: 'string', description: 'Customer phone' },
          carName: { type: 'string', description: 'Car name/model' },
          plate: { type: 'string', description: 'Plate number (admin only)' },
          days: { type: 'number', description: 'Number of rental days' },
          rate: { type: 'number', description: 'Daily rate in RM' },
          amount: { type: 'number', description: 'Total amount (for receipts)' },
          deposit: { type: 'number', description: 'Deposit amount' },
          deliveryFee: { type: 'number', description: 'Delivery fee' },
          startDate: { type: 'string', description: 'Rental start date' },
          endDate: { type: 'string', description: 'Rental end date' },
          paymentMethod: { type: 'string', description: 'Payment method used' },
          title: { type: 'string', description: 'Document title (for notices/custom)' },
          body: { type: 'string', description: 'Document body (for notices/custom)' },
          notes: { type: 'string', description: 'Additional notes' },
        },
        required: ['type'],
      },
    },
  },

  // ─── Task Manager ─────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a task and optionally assign to a team member. Use when boss says "create task", "assign X to Y", "remind team to do Z", or any work assignment.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title/description' },
          assignedName: { type: 'string', description: 'Assign to team member by name (e.g., "Vir Uncle", "Amisha")' },
          dueDate: { type: 'string', description: 'Due date: "today", "tomorrow", "in 3 days", or ISO date' },
          priority: { type: 'string', description: 'Priority: low, normal, high, urgent. Default: normal' },
          category: { type: 'string', description: 'Category: maintenance, delivery, cleaning, paperwork, followup, other. Default: other' },
          linkedCar: { type: 'string', description: 'Related car plate number (optional)' },
          description: { type: 'string', description: 'Additional details' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List tasks with optional filters. Shows pending and in-progress tasks by default.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: pending, in_progress, completed, cancelled' },
          assignedTo: { type: 'string', description: 'Filter by assignee name' },
          category: { type: 'string', description: 'Filter by category' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Update a task status or add a note. Use when boss says "mark task done", "task X is in progress", etc.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID' },
          status: { type: 'string', description: 'New status: pending, in_progress, completed, cancelled' },
          note: { type: 'string', description: 'Add a note to the task' },
        },
        required: ['id'],
      },
    },
  },

  // ─── Workflows (auto-actions) ─────────────────────────

  {
    type: 'function',
    function: {
      name: 'create_workflow',
      description: 'Create an automatic workflow/action. Use when boss says "automatically do X when Y happens", "set up auto-reply for after hours", etc.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Workflow name' },
          trigger: { type: 'string', description: 'Event trigger: after_hours, new_customer, returning_customer, payment_received, booking_confirmed, custom_event' },
          message: { type: 'string', description: 'Message template. Use {{customerName}}, {{phone}}, {{carName}} for variables.' },
          actionType: { type: 'string', description: 'Action type: reply (send to customer), notify_admin (alert team), context (add to AI context). Default: reply' },
          conditions: { type: 'object', description: 'Conditions that must be met (optional). E.g., {"totalBookings": {"$gt": 3}}' },
        },
        required: ['name', 'trigger'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_workflows',
      description: 'List all workflows (built-in + custom).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_workflow',
      description: 'Enable or disable a workflow.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Workflow ID' },
          enabled: { type: 'boolean', description: 'true to enable, false to disable' },
        },
        required: ['id', 'enabled'],
      },
    },
  },
];

// ─── Tool Executor ───────────────────────────────────────
// isAdmin context is passed through to control sensitive data exposure.

async function executeTool(name, args, { isAdmin = false } = {}) {
  switch (name) {
    case 'get_available_cars': {
      const { validateFleetStatus } = require('../utils/validators');
      const [cars, agreements] = await Promise.all([
        fleetService.getAllCars(),
        agreementsService.getActiveAgreements(),
      ]);
      const { validated } = validateFleetStatus(cars, agreements);
      let available = validated.filter(c => (c._validatedStatus || c.status) === 'available');
      if (args.category) {
        available = available.filter(c => (c.body_type || '').toLowerCase() === args.category.toLowerCase());
      }
      return available.map(c => {
        const result = {
          car_name: c._carName || c.body_type || '',
          color: colorName(c.color),
          year: c.year,
          body_type: c.body_type,
          daily_price: c.daily_price,
        };
        if (isAdmin) result.plate_number = c.plate_number;
        return result;
      });
    }

    case 'get_pricing':
      return policies.pricing;

    case 'get_delivery_fee': {
      const fee = policies.getDeliveryFee(args.location);
      if (fee) return fee;
      return { error: `Unknown location: ${args.location}`, zones: policies.deliveryZones };
    }

    case 'lookup_customer': {
      // Only admins can look up other customers
      if (!isAdmin) return { error: 'Customer lookup is only available to admin users.' };
      const history = await agreementsService.getCustomerHistory(args.phone);
      if (!history) return { found: false, message: 'No customer found with this phone number' };
      return {
        found: true,
        name: history.name,
        totalRentals: history.totalRentals,
        totalSpent: history.totalSpent,
        isRegular: history.totalRentals >= 5,
        activeRentals: history.activeRentals.map(a => ({
          car_type: a.car_type || '',
          plate_number: a.plate_number,
          date_start: a.date_start,
          date_end: a.date_end,
          status: a.status,
        })),
      };
    }

    case 'get_active_bookings': {
      // Only admins can see all bookings
      if (!isAdmin) return { error: 'Active bookings list is only available to admin users.' };
      const active = await agreementsService.getActiveAgreements();
      return active.map(a => ({
        customer_name: a.customer_name,
        mobile: a.mobile,
        plate_number: a.plate_number,
        date_start: a.date_start,
        date_end: a.date_end,
        status: a.status,
        days_left: daysBetween(todayMYT(), (a.date_end || '').slice(0, 10)),
      }));
    }

    case 'get_expiring_rentals': {
      if (!isAdmin) return { error: 'Expiring rentals list is only available to admin users.' };
      const expiring = await agreementsService.getExpiringAgreements(args.days || 3);
      return expiring.map(a => ({
        customer_name: a.customer_name,
        mobile: a.mobile,
        plate_number: a.plate_number,
        date_end: a.date_end,
        days_left: daysBetween(todayMYT(), (a.date_end || '').slice(0, 10)),
      }));
    }

    case 'get_overdue_rentals': {
      if (!isAdmin) return { error: 'Overdue rentals list is only available to admin users.' };
      const overdue = await agreementsService.getOverdueAgreements();
      return overdue.map(a => ({
        customer_name: a.customer_name,
        mobile: a.mobile,
        plate_number: a.plate_number,
        date_end: a.date_end,
        days_overdue: daysBetween((a.date_end || '').slice(0, 10), todayMYT()),
      }));
    }

    case 'get_fleet_status': {
      const stats = await fleetService.getFleetStats();
      return stats;
    }

    case 'search_cars': {
      const results = await fleetService.searchCars(args.query);
      return results.map(c => {
        const result = {
          car_name: c._carName || c.body_type || '',
          color: colorName(c.color),
          status: c.status,
          daily_price: c.daily_price,
        };
        if (isAdmin) result.plate_number = c.plate_number;
        return result;
      });
    }

    case 'get_payment_info':
      return {
        methods: policies.payment.methods,
        bank: policies.payment.bank,
        instructions: policies.payment.instructions,
      };

    case 'get_policies': {
      const p = args.policy?.toLowerCase();
      const map = {
        deposit: policies.deposit,
        cancellation: policies.cancellation,
        extension: policies.extension,
        fuel: policies.fuel,
        cleanliness: policies.cleanliness,
        insurance: policies.insurance,
        documents: policies.documents,
      };
      return map[p] || { error: `Unknown policy: ${p}`, available: Object.keys(map) };
    }

    case 'get_delivery_by_coordinates': {
      const locationService = require('../utils/location');
      const zone = locationService.matchDeliveryZone(args.latitude, args.longitude);
      const geo = await locationService.reverseGeocode(args.latitude, args.longitude);
      return {
        address: geo.fullAddress || 'Unknown',
        area: geo.area || 'Unknown',
        zone: zone.zone,
        fee: zone.fee,
        distanceKm: zone.distanceKm,
        label: zone.label,
        mapsLink: locationService.mapsLink(args.latitude, args.longitude),
        directionsToJrv: locationService.directionsToJrv(args.latitude, args.longitude),
      };
    }

    case 'get_jrv_location': {
      const locationService = require('../utils/location');
      return {
        name: 'JRV Car Rental',
        branches: [
          '195, Jalan S2 B14, Seremban 2, 70300 Seremban, Negeri Sembilan',
          'Lot 12071, Jalan Sungai Ujong, Taman Ast, 70200 Seremban, Negeri Sembilan',
        ],
        mapsLink: locationService.jrvLocation(),
        website: 'https://jrvservices.co',
      };
    }

    case 'lookup_team_member': {
      if (!isAdmin) return { error: 'Team info is only available to admin users.' };
      const query = (args.query || '').toLowerCase();
      const admins = policies.admins.list;

      if (query === 'all' || query === 'team') {
        return admins.map(a => ({
          name: a.name,
          role: a.role,
          title: a.title,
          phone: a.phone,
          relationship: a.relationship,
          isBoss: a.isBoss || false,
          isSuperadmin: a.isSuperadmin || false,
        }));
      }

      const match = admins.find(a =>
        a.name.toLowerCase().includes(query) ||
        a.phone.includes(query.replace(/\D/g, '')) ||
        (a.title && a.title.toLowerCase().includes(query)) ||
        (a.role && a.role.toLowerCase().includes(query))
      );

      if (match) {
        return {
          name: match.name,
          role: match.role,
          title: match.title,
          phone: match.phone,
          relationship: match.relationship,
          style: match.style,
          isBoss: match.isBoss || false,
          isSuperadmin: match.isSuperadmin || false,
        };
      }

      return { found: false, message: `No team member matching "${args.query}"`, team: admins.map(a => a.name) };
    }

    case 'get_reports': {
      if (!isAdmin) return { error: 'Reports are only available to admin users.' };
      const reports = require('../brain/reports');
      const requested = (args.reports || 'all').toLowerCase();

      const reportMap = {
        '1': () => reports.sortedByTime(),
        '2': () => reports.sortedByContact(),
        '3': () => reports.sortedByTimeslot(),
        '4': () => reports.followUpReport(),
        '5': () => reports.availableReport(),
        '6': () => reports.summaryReport(),
        'fleet': () => reports.fleetReport(),
        'earnings': () => reports.earningsReport(),
      };

      let keys;
      if (requested === 'all' || requested === 'daily') {
        keys = ['1', '2', '3', '4', '5', '6'];
      } else {
        keys = requested.split(/[,\s]+/).map(k => k.trim()).filter(Boolean);
      }

      const results = [];
      for (const key of keys) {
        const gen = reportMap[key];
        if (gen) {
          results.push(await gen());
        } else {
          results.push(`Unknown report: ${key}`);
        }
      }
      // Reports are pre-formatted WhatsApp text — AI must send as-is
      return results.join('\n\n───────────────\n\n');
    }

    case 'get_system_stats': {
      const aiRouter = require('./router');
      const cfg = require('../config');
      const stats = aiRouter.getStats();
      const os = require('os');
      return {
        cloudProvider: cfg.cloudProvider,
        activeModel: cfg.cloudProvider === 'groq' ? cfg.groq.model : cfg.kimi.model,
        kimi: { model: cfg.kimi.model, available: !!cfg.kimi.apiKey, calls: stats.kimiStats?.calls || 0, tokens: stats.kimiStats?.tokens || 0 },
        groq: { model: cfg.groq.model, available: !!cfg.groq.apiKey, calls: stats.groqStats?.calls || 0, tokens: stats.groqStats?.tokens || 0 },
        ollama: { model: cfg.localAI.model, available: aiRouter.localAvailable },
        totalToolCalls: stats.toolCalls,
        cacheHits: stats.cacheHits,
        uptime: `${Math.round(os.uptime() / 3600)}h`,
        heapMemory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        jarvisMemory: stats.memoryStats || { memories: 0, rules: 0 },
        skills: stats.skillStats || { total: 0, enabled: 0 },
        knowledgeBase: stats.kbStats || { total: 0 },
        customerProfiles: stats.profileStats || { totalProfiles: 0 },
        tasks: stats.taskStats || { pending: 0 },
        workflows: stats.workflowStats || { customWorkflows: 0 },
        documents: stats.docStats || { documentsGenerated: 0 },
        webSearch: require('../utils/web-search').getStats(),
        switchCmd: '/switch <kimi|groq> [model]',
      };
    }

    // ─── Web Search & URL Fetch ────────────────────────────

    case 'web_search': {
      const webSearch = require('../utils/web-search');
      const results = await webSearch.search(args.query, {
        maxResults: args.max_results || 5,
      });
      return results;
    }

    case 'fetch_url': {
      if (!args.url || !/^https?:\/\//i.test(args.url)) {
        return { error: 'Invalid URL. Must start with http:// or https://' };
      }
      const webSearch = require('../utils/web-search');
      const result = await webSearch.fetchUrl(args.url, {
        maxLength: args.max_length || 5000,
      });
      return result;
    }

    // ─── Data Store Query ────────────────────────────────────

    case 'query_data_store': {
      if (!isAdmin) return { error: 'Data store access is only available to admin users.' };

      const action = (args.action || '').toLowerCase();

      if (action === 'list_keys') {
        const all = await dataStoreService.getAll();
        return {
          count: all.length,
          keys: all.map(entry => ({
            key: entry.key,
            type: typeof entry.value === 'object' ? (Array.isArray(entry.value) ? 'array' : 'object') : typeof entry.value,
          })),
        };
      }

      if (action === 'get') {
        if (!args.key) return { error: 'Missing "key" parameter. Specify the exact key to read.' };
        const value = await dataStoreService.getByKey(args.key);
        if (value === null) return { found: false, message: `Key "${args.key}" not found in data store.` };
        // Truncate large values to avoid token overflow
        const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return {
          found: true,
          key: args.key,
          value: str.length > 4000 ? str.slice(0, 4000) + '\n... (truncated)' : value,
        };
      }

      if (action === 'search') {
        if (!args.key) return { error: 'Missing "key" parameter. Specify a prefix to search (e.g., "jarvis_report").' };
        const results = await dataStoreService.getByKeyPrefix(args.key);
        if (results.length === 0) return { found: false, message: `No keys matching prefix "${args.key}".` };
        return {
          count: results.length,
          results: results.map(entry => {
            const str = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
            return {
              key: entry.key,
              value: str.length > 2000 ? str.slice(0, 2000) + '... (truncated)' : entry.value,
            };
          }),
        };
      }

      return { error: `Unknown action "${action}". Use: list_keys, get, or search.` };
    }

    // ─── Memory & Rules Tools ──────────────────────────────

    case 'save_memory': {
      if (!isAdmin) return { error: 'Only admin/boss can save memories.' };
      const memory = require('../brain/memory');
      const result = await memory.saveMemory(
        args.content,
        args.type || 'fact',
        args.tags || [],
        'boss'
      );
      return { saved: true, id: result.id, content: result.content, type: result.type };
    }

    case 'recall_memory': {
      if (!isAdmin) return { error: 'Only admin can access memories.' };
      const memory = require('../brain/memory');
      const results = memory.searchMemories(args.query);
      if (results.length === 0) return { found: false, message: `No memories matching "${args.query}"` };
      return results.map(m => ({ id: m.id, content: m.content, type: m.type, tags: m.tags }));
    }

    case 'list_memories': {
      if (!isAdmin) return { error: 'Only admin can access memories.' };
      const memory = require('../brain/memory');
      const list = memory.listMemories(args.type || null);
      if (list.length === 0) return { count: 0, message: 'No memories stored yet.' };
      return { count: list.length, memories: list.map(m => ({ id: m.id, content: m.content, type: m.type, tags: m.tags })) };
    }

    case 'delete_memory': {
      if (!isAdmin) return { error: 'Only admin/boss can delete memories.' };
      const memory = require('../brain/memory');
      const deleted = await memory.deleteMemory(args.id);
      return deleted ? { deleted: true, id: args.id } : { deleted: false, message: `Memory "${args.id}" not found` };
    }

    case 'add_rule': {
      if (!isAdmin) return { error: 'Only admin/boss can add rules.' };
      const memory = require('../brain/memory');
      const rule = await memory.addRule(
        args.content,
        args.type || 'always',
        args.priority || 'normal',
        'boss'
      );
      return { added: true, id: rule.id, content: rule.content, type: rule.type, priority: rule.priority };
    }

    case 'update_rule': {
      if (!isAdmin) return { error: 'Only admin/boss can update rules.' };
      const memory = require('../brain/memory');
      const updated = await memory.updateRule(args.id, args.content);
      return updated ? { updated: true, id: args.id, content: updated.content } : { updated: false, message: `Rule "${args.id}" not found` };
    }

    case 'list_rules': {
      if (!isAdmin) return { error: 'Only admin can access rules.' };
      const memory = require('../brain/memory');
      const rules = memory.listRules(args.type || null);
      if (rules.length === 0) return { count: 0, message: 'No dynamic rules set yet.' };
      return { count: rules.length, rules: rules.map(r => ({ id: r.id, content: r.content, type: r.type, priority: r.priority })) };
    }

    case 'delete_rule': {
      if (!isAdmin) return { error: 'Only admin/boss can delete rules.' };
      const memory = require('../brain/memory');
      const deleted = await memory.deleteRule(args.id);
      return deleted ? { deleted: true, id: args.id } : { deleted: false, message: `Rule "${args.id}" not found` };
    }

    // ─── Skill Scripts ──────────────────────────────────────

    case 'save_skill': {
      if (!isAdmin) return { error: 'Only admin/boss can teach skills.' };
      const skills = require('../brain/skills');
      const result = await skills.save(args.name, {
        trigger: args.trigger,
        steps: args.steps,
        context: args.context,
        tags: args.tags || [],
      });
      return { saved: true, id: result.id, name: result.name, steps: result.steps.length, version: result.version };
    }

    case 'find_skill': {
      const skills = require('../brain/skills');
      const results = skills.find(args.query);
      if (results.length === 0) return { found: false, message: `No skills matching "${args.query}"` };
      return results.map(s => ({ id: s.id, name: s.name, trigger: s.trigger, steps: s.steps }));
    }

    case 'list_skills': {
      const skills = require('../brain/skills');
      const list = skills.list();
      if (list.length === 0) return { count: 0, message: 'No skills learned yet. Teach me with save_skill.' };
      return { count: list.length, skills: list.map(s => ({ id: s.id, name: s.name, trigger: s.trigger, stepsCount: s.steps.length })) };
    }

    case 'delete_skill': {
      if (!isAdmin) return { error: 'Only admin/boss can delete skills.' };
      const skills = require('../brain/skills');
      const deleted = await skills.delete(args.id);
      return deleted ? { deleted: true, id: args.id } : { deleted: false, message: `Skill "${args.id}" not found` };
    }

    // ─── Knowledge Base ─────────────────────────────────────

    case 'kb_upsert': {
      if (!isAdmin) return { error: 'Only admin can manage the knowledge base.' };
      const kb = require('../brain/knowledge');
      const result = await kb.upsert(args.topic, {
        question: args.question,
        answer: args.answer,
        category: args.category || 'general',
        tags: args.tags || [],
      });
      return { saved: true, id: result.id, topic: result.topic, category: result.category, version: result.version };
    }

    case 'kb_search': {
      const kb = require('../brain/knowledge');
      const results = kb.search(args.query, { category: args.category });
      if (results.length === 0) return { found: false, message: `No KB articles matching "${args.query}"` };
      return results.map(a => ({ id: a.id, topic: a.topic, question: a.question, answer: a.answer, category: a.category }));
    }

    case 'kb_list': {
      const kb = require('../brain/knowledge');
      const list = kb.list(args.category || null);
      if (list.length === 0) return { count: 0, message: 'Knowledge base is empty. Add articles with kb_upsert.' };
      return { count: list.length, categories: kb.categories(), articles: list.map(a => ({ id: a.id, topic: a.topic, question: a.question, category: a.category })) };
    }

    case 'kb_delete': {
      if (!isAdmin) return { error: 'Only admin can delete KB articles.' };
      const kb = require('../brain/knowledge');
      const deleted = await kb.delete(args.id);
      return deleted ? { deleted: true, id: args.id } : { deleted: false, message: `Article "${args.id}" not found` };
    }

    // ─── Customer Profiles ──────────────────────────────────

    case 'get_customer_profile': {
      if (!isAdmin) return { error: 'Customer profiles are only available to admin users.' };
      const profiles = require('../brain/customer-profiles');
      const profile = profiles.get(args.phone);
      return {
        phone: args.phone,
        name: profile.name,
        interactions: profile.interactions,
        preferredLang: profile.preferredLang,
        preferredCarType: profile.preferredCarType,
        totalBookings: profile.totalBookings,
        tags: profile.tags,
        adminNotes: (profile.adminNotes || []).slice(-5),
        bookingHistory: (profile.bookingHistory || []).slice(-5),
        firstSeen: profile.firstSeen,
        lastSeen: profile.lastSeen,
      };
    }

    case 'add_customer_note': {
      if (!isAdmin) return { error: 'Only admin can add customer notes.' };
      const profiles = require('../brain/customer-profiles');
      await profiles.addNote(args.phone, args.note);
      return { added: true, phone: args.phone, note: args.note };
    }

    case 'tag_customer': {
      if (!isAdmin) return { error: 'Only admin can tag customers.' };
      const profiles = require('../brain/customer-profiles');
      if ((args.action || 'add') === 'remove') {
        await profiles.removeTag(args.phone, args.tag);
        return { removed: true, phone: args.phone, tag: args.tag };
      }
      await profiles.setTag(args.phone, args.tag);
      return { tagged: true, phone: args.phone, tag: args.tag };
    }

    case 'search_customers': {
      if (!isAdmin) return { error: 'Customer search is only available to admin users.' };
      const profiles = require('../brain/customer-profiles');
      const results = profiles.search(args.query);
      if (results.length === 0) return { found: false, message: `No customer profiles matching "${args.query}"` };
      return results.slice(0, 10).map(p => ({
        phone: p.phone,
        name: p.name,
        tags: p.tags,
        totalBookings: p.totalBookings,
        lastSeen: p.lastSeen,
      }));
    }

    // ─── Document Generator ─────────────────────────────────

    case 'create_document': {
      if (!isAdmin) return { error: 'Only admin can generate documents.' };
      const docs = require('../brain/documents');
      const result = await docs.generate(args.type, args);
      return result;
    }

    // ─── Task Manager ───────────────────────────────────────

    case 'create_task': {
      if (!isAdmin) return { error: 'Only admin can create tasks.' };
      const taskMgr = require('../brain/tasks');
      const task = await taskMgr.create({
        title: args.title,
        description: args.description,
        assignedName: args.assignedName,
        dueDate: args.dueDate,
        priority: args.priority || 'normal',
        category: args.category || 'other',
        linkedCar: args.linkedCar,
      });
      return { created: true, id: task.id, title: task.title, assignedName: task.assignedName, dueDate: task.dueDate, priority: task.priority };
    }

    case 'list_tasks': {
      if (!isAdmin) return { error: 'Only admin can view tasks.' };
      const taskMgr = require('../brain/tasks');
      const tasks = taskMgr.list({
        status: args.status,
        assignedTo: args.assignedTo,
        category: args.category,
      });
      if (tasks.length === 0) return { count: 0, message: 'No active tasks.' };
      return {
        count: tasks.length,
        overdue: taskMgr.getOverdue().length,
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          assignedName: t.assignedName,
          dueDate: t.dueDate,
          priority: t.priority,
          category: t.category,
        })),
      };
    }

    case 'update_task': {
      if (!isAdmin) return { error: 'Only admin can update tasks.' };
      const taskMgr = require('../brain/tasks');
      let result;
      if (args.status) {
        result = await taskMgr.updateStatus(args.id, args.status);
      }
      if (args.note) {
        result = await taskMgr.addNote(args.id, args.note);
      }
      if (!result) return { error: `Task "${args.id}" not found` };
      return { updated: true, id: args.id, status: result.status, title: result.title };
    }

    // ─── Workflows ──────────────────────────────────────────

    case 'create_workflow': {
      if (!isAdmin) return { error: 'Only admin can create workflows.' };
      const workflows = require('../brain/workflows');
      const wf = await workflows.create({
        name: args.name,
        trigger: args.trigger,
        message: args.message,
        actionType: args.actionType || 'reply',
        conditions: args.conditions || {},
      });
      return { created: true, id: wf.id, name: wf.name, trigger: wf.trigger };
    }

    case 'list_workflows': {
      const workflows = require('../brain/workflows');
      return workflows.list();
    }

    case 'toggle_workflow': {
      if (!isAdmin) return { error: 'Only admin can toggle workflows.' };
      const workflows = require('../brain/workflows');
      const result = await workflows.toggle(args.id, args.enabled);
      if (!result) return { error: `Workflow "${args.id}" not found` };
      return { toggled: true, id: args.id, enabled: result.enabled, name: result.name };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { TOOLS, executeTool };
