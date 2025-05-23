const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const logger = require('../utils/logger');

// Register a new user
const register = async (req, res) => {
    try {
        const { username, email, password, organizationId } = req.body;

        if (!organizationId) {
            return res.status(400).json({
                message: 'Organization ID is required'
            });
        }

        // Check if user with email or username already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { username }],
        });

        if (existingUser) {
            return res.status(409).json({
                message: 'User with this email or username already exists',
            });
        }

        // Create new user
        const user = new User({
            username,
            email,
            password,
            organizationId,
        });

        await user.save();

        // Generate JWT token
        const token = jwt.sign({ userId: user._id }, config.jwtSecret, {
            expiresIn: '7d',
        });

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                organizationId: user.organizationId
            },
            token,
        });
    } catch (error) {
        logger.error(`Registration error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Login user
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user by email
        const user = await User.findOne({ email, isActive: true });

        // If user doesn't exist or password is incorrect
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user._id }, config.jwtSecret, {
            expiresIn: '7d',
        });

        res.status(200).json({
            message: 'Login successful',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                organizationId: user.organizationId
            },
            token,
        });
    } catch (error) {
        logger.error(`Login error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get current user profile
const getProfile = async (req, res) => {
    try {
        res.status(200).json({
            user: {
                id: req.user._id,
                username: req.user.username,
                email: req.user.email,
                role: req.user.role,
                organizationId: req.user.organizationId
            },
        });
    } catch (error) {
        logger.error(`Get profile error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Generate API key for user
const generateApiKey = async (req, res) => {
    try {
        const apiKey = await req.user.generateApiKey();

        res.status(200).json({
            message: 'API key generated successfully',
            apiKey,
        });
    } catch (error) {
        logger.error(`Generate API key error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get users in the organization (admin only)
const getUsersInOrganization = async (req, res) => {
    try {
        // Only admins can list users
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                message: 'Access denied: Admin privileges required'
            });
        }

        const { page = 1, limit = 10 } = req.query;
        
        // For superadmins, allow passing an organization ID
        let organizationId = req.user.organizationId;
        if (req.user.role === 'superadmin' && req.query.organizationId) {
            organizationId = req.query.organizationId;
        }
        
        const query = { organizationId };
        
        const options = {
            sort: { username: 1 },
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
        };
        
        const users = await User.find(query)
            .sort(options.sort)
            .limit(options.limit)
            .skip((options.page - 1) * options.limit)
            .select('-password');
        
        const total = await User.countDocuments(query);
        
        res.status(200).json({
            users,
            totalPages: Math.ceil(total / options.limit),
            currentPage: options.page,
            totalUsers: total,
        });
    } catch (error) {
        logger.error(`Get users error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update user (self or admin)
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, role, isActive } = req.body;
        
        // Regular users can only update themselves
        // Admins can update any user in their organization
        // Superadmins can update any user
        let user;
        
        if (req.user.role === 'superadmin') {
            user = await User.findById(id);
        } else if (req.user.role === 'admin') {
            user = await User.findOne({ 
                _id: id, 
                organizationId: req.user.organizationId 
            });
        } else {
            // Regular users can only update themselves
            if (id !== req.user._id.toString()) {
                return res.status(403).json({ 
                    message: 'Access denied: You can only update your own profile' 
                });
            }
            user = await User.findById(id);
        }
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // Update fields
        if (username) user.username = username;
        if (email) user.email = email;
        
        // Only admins can update roles and active status
        if ((req.user.role === 'admin' || req.user.role === 'superadmin') && role) {
            // Admins cannot create superadmins
            if (req.user.role === 'admin' && role === 'superadmin') {
                return res.status(403).json({
                    message: 'Access denied: Cannot create superadmin users'
                });
            }
            user.role = role;
        }
        
        if ((req.user.role === 'admin' || req.user.role === 'superadmin') && isActive !== undefined) {
            user.isActive = isActive;
        }
        
        await user.save();
        
        res.status(200).json({
            message: 'User updated successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                organizationId: user.organizationId,
                isActive: user.isActive
            }
        });
    } catch (error) {
        logger.error(`Update user error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get user by ID
const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Regular users can only view themselves
        // Admins can view any user in their organization
        // Superadmins can view any user
        let user;
        
        if (req.user.role === 'superadmin') {
            user = await User.findById(id).select('-password');
        } else if (req.user.role === 'admin') {
            user = await User.findOne({ 
                _id: id, 
                organizationId: req.user.organizationId 
            }).select('-password');
        } else {
            // Regular users can only view themselves
            if (id !== req.user._id.toString()) {
                return res.status(403).json({ 
                    message: 'Access denied: You can only view your own profile' 
                });
            }
            user = await User.findById(id).select('-password');
        }
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.status(200).json({
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                organizationId: user.organizationId,
                isActive: user.isActive,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            }
        });
    } catch (error) {
        logger.error(`Get user by ID error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Search for users with filtering options
const searchUsers = async (req, res) => {
    try {
        // Only admins and superadmins can search users
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({
                message: 'Access denied: Admin privileges required'
            });
        }

        const { 
            username, 
            email, 
            role, 
            isActive, 
            page = 1, 
            limit = 10,
            sortBy = 'username',
            sortOrder = 'asc'
        } = req.query;
        
        // Build query
        const query = {};
        
        // Organization filtering
        if (req.user.role === 'admin') {
            // Admins can only see users in their organization
            query.organizationId = req.user.organizationId;
        } else if (req.user.role === 'superadmin' && req.query.organizationId) {
            // Superadmins can filter by organization
            query.organizationId = req.query.organizationId;
        }
        
        // Apply filters
        if (username) {
            query.username = { $regex: username, $options: 'i' };
        }
        
        if (email) {
            query.email = { $regex: email, $options: 'i' };
        }
        
        if (role) {
            query.role = role;
        }
        
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }
        
        // Sorting
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
        
        // Pagination
        const options = {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
        };
        
        // Execute query
        const users = await User.find(query)
            .sort(sortOptions)
            .limit(options.limit)
            .skip((options.page - 1) * options.limit)
            .select('-password');
        
        const total = await User.countDocuments(query);
        
        res.status(200).json({
            users,
            totalPages: Math.ceil(total / options.limit),
            currentPage: options.page,
            totalUsers: total,
        });
    } catch (error) {
        logger.error(`Search users error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

// Create admin/superadmin user
const createAdminUser = async (req, res) => {
    try {
        const { username, email, password, role, organizationId } = req.body;

        // Only superadmins can create admins/superadmins directly
        // Regular admins can update roles but not directly create admin users
        if (req.user.role !== 'superadmin' && (role === 'admin' || role === 'superadmin')) {
            return res.status(403).json({
                message: 'Access denied: Superadmin privileges required to create admin users'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { username }],
        });

        if (existingUser) {
            return res.status(409).json({
                message: 'User with this email or username already exists',
            });
        }

        // Create new user with specified role
        const user = new User({
            username,
            email,
            password,
            role: role || 'user', // Default to 'user' if not specified
            organizationId,
        });

        await user.save();
        
        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                organizationId: user.organizationId,
                isActive: user.isActive
            }
        });
    } catch (error) {
        logger.error(`Create admin user error: ${error.message}`);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    register,
    login,
    getProfile,
    generateApiKey,
    getUsersInOrganization,
    updateUser,
    getUserById,
    searchUsers,
    createAdminUser
};
